import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import GestionRendezvous from './GestionRendezvous';
import { useSession } from '../auth/useSession';
import { changerStatutRendezvous, listerRendezvous, listerMotifsDesistement } from '../../services/rendezvousService';

vi.mock('../auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/rendezvousService', () => ({
  listerRendezvous: vi.fn(),
  changerStatutRendezvous: vi.fn(),
  listerMotifsDesistement: vi.fn(),
}));
vi.mock('./useRafraichissementAuto', () => ({ useRafraichissementAuto: vi.fn() }));

const RENDEZVOUS_PREVU = {
  id: 1,
  statut: 'prevu',
  type_rdv: 'test',
  date_heure: '2026-11-05T09:00:00.000Z',
  planifie_le: '2026-10-20T08:00:00.000Z',
  planifie_par_prenom: 'Awa',
  planifie_par_nom: 'Diallo',
  planifie_par_role_libelle: 'Accueil / Coordination',
};

const SESSION_EN_COURS = { utilisateur: null, chargement: true, erreur: null };
const SESSION_ACCUEIL = {
  utilisateur: { id: 1, roleCode: 'accueil_coordination', permissions: ['gestionRendezvous'] },
  chargement: false,
  erreur: null,
};

beforeEach(() => {
  listerRendezvous.mockResolvedValue([RENDEZVOUS_PREVU]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function afficher() {
  return <GestionRendezvous dossierId={12} codeStatutDossier="test_planifie" />;
}

test('charge les motifs de désistement quand la session se résout après le premier rendu', async () => {
  listerMotifsDesistement.mockResolvedValue([
    { code: 'indisponible', libelle: 'Finalement indisponible' },
    { code: 'autre', libelle: 'Autre motif' },
  ]);
  useSession.mockReturnValue(SESSION_EN_COURS);
  const { rerender } = render(afficher());
  expect(listerMotifsDesistement).not.toHaveBeenCalled();

  useSession.mockReturnValue(SESSION_ACCUEIL);
  rerender(afficher());

  fireEvent.click(await screen.findByRole('button', { name: 'Marquer annulé' }));
  expect(await screen.findByRole('option', { name: 'Finalement indisponible' })).toBeTruthy();
  expect(screen.queryByText('Aucun motif configuré')).toBeNull();
  expect(screen.getByRole('button', { name: 'Confirmer le désistement' }).disabled).toBe(false);
  expect(listerMotifsDesistement).toHaveBeenCalledTimes(1);
});

test("affiche une erreur explicite quand le chargement des motifs échoue", async () => {
  listerMotifsDesistement.mockRejectedValue({ response: { status: 500 } });
  useSession.mockReturnValue(SESSION_ACCUEIL);
  render(afficher());

  fireEvent.click(await screen.findByRole('button', { name: 'Marquer annulé' }));
  await waitFor(() => expect(screen.getByText('Impossible de charger les motifs de désistement.')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Confirmer le désistement' }).disabled).toBe(true);
});

test("ne demande pas les motifs à un rôle sans droit de gestion", async () => {
  useSession.mockReturnValue({
    utilisateur: { id: 2, roleCode: 'formateur', permissions: ['lectureRendezvous'] },
    chargement: false,
    erreur: null,
  });
  render(afficher());

  await screen.findByText(/Planifié le/);
  expect(listerMotifsDesistement).not.toHaveBeenCalled();
});

const MOTIFS_AVEC_AUTRE = [
  { code: 'ne_repond_plus', libelle: 'Ne répond plus' },
  { code: 'autre', libelle: 'Autre motif' },
];

async function ouvrirDesistement() {
  listerMotifsDesistement.mockResolvedValue(MOTIFS_AVEC_AUTRE);
  useSession.mockReturnValue(SESSION_ACCUEIL);
  render(afficher());
  fireEvent.click(await screen.findByRole('button', { name: 'Marquer annulé' }));
  await screen.findByRole('option', { name: 'Autre motif' });
}

test('« Autre motif » affiche un champ de précision obligatoire avec compteur, et bloque la confirmation tant qu\'il est vide', async () => {
  await ouvrirDesistement();
  expect(screen.queryByLabelText(/Précisez le motif/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Confirmer le désistement' }).disabled).toBe(false);

  fireEvent.change(screen.getByLabelText('Motif du désistement (obligatoire)'), { target: { value: 'autre' } });
  const champ = screen.getByLabelText(/Précisez le motif/);
  expect(champ.maxLength).toBe(200);
  expect(screen.getByText('0/200')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirmer le désistement' }).disabled).toBe(true);

  fireEvent.change(champ, { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: 'Confirmer le désistement' }).disabled).toBe(true);

  fireEvent.change(champ, { target: { value: "Garde d'enfant" } });
  expect(screen.getByText('14/200')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirmer le désistement' }).disabled).toBe(false);
});

test('la précision est envoyée avec le motif « Autre motif », et seulement avec lui', async () => {
  changerStatutRendezvous.mockResolvedValue({});
  await ouvrirDesistement();

  fireEvent.change(screen.getByLabelText('Motif du désistement (obligatoire)'), { target: { value: 'autre' } });
  fireEvent.change(screen.getByLabelText(/Précisez le motif/), { target: { value: "  Garde d'enfant " } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le désistement' }));

  await waitFor(() => expect(changerStatutRendezvous).toHaveBeenCalledTimes(1));
  expect(changerStatutRendezvous).toHaveBeenCalledWith(12, 1, {
    statut: 'annule',
    motifCode: 'autre',
    motifPrecision: "Garde d'enfant",
  });
});

test('un autre motif est envoyé sans précision', async () => {
  changerStatutRendezvous.mockResolvedValue({});
  await ouvrirDesistement();

  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le désistement' }));

  await waitFor(() => expect(changerStatutRendezvous).toHaveBeenCalledTimes(1));
  expect(changerStatutRendezvous).toHaveBeenCalledWith(12, 1, { statut: 'annule', motifCode: 'ne_repond_plus' });
});

test('un rendez-vous annulé pour « Autre motif » affiche « Autre motif : <précision> »', async () => {
  listerRendezvous.mockResolvedValue([
    { ...RENDEZVOUS_PREVU, statut: 'annule', motif_code: 'autre', motif_libelle: 'Autre motif', motif_precision: "Garde d'enfant" },
  ]);
  useSession.mockReturnValue(SESSION_ACCUEIL);
  listerMotifsDesistement.mockResolvedValue(MOTIFS_AVEC_AUTRE);
  render(afficher());

  expect(await screen.findByText("Autre motif : Garde d'enfant")).toBeTruthy();
});
