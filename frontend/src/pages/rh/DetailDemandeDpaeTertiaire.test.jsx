import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DetailDemandeDpae from './DetailDemandeDpae';
import { useSession } from '../../core/auth/useSession';
import * as dpaeService from '../../services/dpaeService';

vi.mock('../../core/auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dpaeService', () => ({
  obtenirDemande: vi.fn(),
  validerDemande: vi.fn(),
  rejeterDemande: vi.fn(),
  mettreEnAttenteDemande: vi.fn(),
  transmettreDemandeALaRh: vi.fn(),
  renvoyerDemandeAInspecteur: vi.fn(),
  classerSansSuiteDemande: vi.fn(),
  envoyerAuPlanningDemande: vi.fn(),
  retransmettreDemandeALaRh: vi.fn(),
  reactiverDemande: vi.fn(),
  listerNotesDemande: vi.fn().mockResolvedValue([]),
  ajouterNoteDemande: vi.fn(),
}));
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));
vi.mock('../../core/dossier/NotesDossier', () => ({ default: () => <p>notes de la demande</p> }));
vi.mock('../../core/dossier/BoutonBlacklister', () => ({ default: () => null }));
vi.mock('../../core/dpae/TelechargementPdfDpae', () => ({ BoutonTelechargerPdfDemande: () => null }));

// Fiche d'une demande du Tertiaire : le Planning Tertiaire la traite jusqu'au bout et peut la renvoyer au
// formateur (motif obligatoire) ; jamais pour une demande qu'il a lui-même créée.
const PLANNING_TERTIAIRE = {
  id: 8,
  roleCode: 'planning_tertiaire',
  permissions: ['dpaeConsultation', 'dpaeTraitementRh', 'dpaeValidationPlanning', 'dpaeClassementSansSuite', 'dpaeClassementSansSuiteToutes', 'dpaeNotes', 'dpaeNotesToutes'],
};
const FORMATEUR_TERTIAIRE = { id: 5, roleCode: 'inspecteur', permissions: ['dpaeConsultation', 'dpaeEnvoiPlanning', 'dpaeRetransmissionRh', 'dpaeClassementSansSuite', 'dpaeNotes'] };
const RH = { id: 4, roleCode: 'rh', permissions: ['dpaeConsultation', 'dpaeTraitementRh'] };

function demande(surcharges = {}) {
  return {
    id: 7,
    version: 3,
    statut: 'envoyee',
    division: 'tertiaire',
    type_demande: 'nouvelle_embauche',
    date_creation: '2026-10-01T08:00:00Z',
    demandeur_id: 5,
    demandeur_role_code: 'inspecteur',
    demandeur_prenom: 'Fanny',
    demandeur_nom: 'Martin',
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
    type_contrat: 'cdi',
    poste: 'nettoyage',
    date_debut: '2026-10-12',
    sites_affectation: [],
    semaine_type: [],
    ...surcharges,
  };
}

function afficher(utilisateur, surcharges) {
  useSession.mockReturnValue({ utilisateur, chargement: false });
  dpaeService.obtenirDemande.mockResolvedValue(demande(surcharges));
  render(
    <MemoryRouter initialEntries={['/rh/dpae/7']}>
      <Routes>
        <Route path="/rh/dpae/:demandeId" element={<DetailDemandeDpae />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const bouton = (nom) => screen.queryByRole('button', { name: nom });

describe('Fiche d’une demande du Tertiaire', () => {
  it('le Planning Tertiaire peut valider, rejeter, mettre en attente, classer sans suite et renvoyer au formateur', async () => {
    afficher(PLANNING_TERTIAIRE);
    await screen.findByRole('button', { name: 'Valider' });
    for (const nom of ['Valider', 'Rejeter', 'Mettre en attente', 'Classer sans suite', 'Renvoyer au formateur']) expect(bouton(nom), nom).toBeTruthy();
    // Jamais de passage par la RH.
    expect(bouton('Transmettre à la RH')).toBeNull();
  });

  it('« Renvoyer au formateur » absent sur une demande créée par le Planning Tertiaire lui-même', async () => {
    afficher(PLANNING_TERTIAIRE, { demandeur_id: 8, demandeur_role_code: 'planning_tertiaire' });
    await screen.findByRole('button', { name: 'Valider' });
    expect(bouton('Renvoyer au formateur')).toBeNull();
    expect(bouton('Rejeter')).toBeTruthy();
  });

  it('« Renvoyer au formateur » absent sur une demande de l’Hôtellerie (circuit inchangé : renvoi depuis « À valider » seulement)', async () => {
    afficher(PLANNING_TERTIAIRE, { division: 'hotellerie', demandeur_role_code: 'inspecteur_hotellerie' });
    await screen.findByText('notes de la demande');
    expect(bouton('Renvoyer au formateur')).toBeNull();
  });

  it('le renvoi demande un motif : « Confirmer » transmet version et motif, la demande est rechargée', async () => {
    afficher(PLANNING_TERTIAIRE);
    fireEvent.click(await screen.findByRole('button', { name: 'Renvoyer au formateur' }));
    const fenetre = await screen.findByRole('dialog');
    expect(within(fenetre).getByRole('heading', { name: 'Renvoyer la demande au formateur ?' })).toBeTruthy();
    fireEvent.change(within(fenetre).getByRole('textbox'), { target: { value: 'Site manquant.' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService.renvoyerDemandeAInspecteur).toHaveBeenCalledWith('7', 3, 'Site manquant.'));
  });

  it('renvoi sans motif : le refus du serveur « Le motif du renvoi est obligatoire. » s’affiche dans la fenêtre, restée ouverte', async () => {
    dpaeService.renvoyerDemandeAInspecteur.mockRejectedValueOnce({ response: { status: 400, data: { erreur: 'Le motif du renvoi est obligatoire.' } } });
    afficher(PLANNING_TERTIAIRE);
    fireEvent.click(await screen.findByRole('button', { name: 'Renvoyer au formateur' }));
    const fenetre = await screen.findByRole('dialog');
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    expect(await within(fenetre).findByText('Le motif du renvoi est obligatoire.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('le statut s’affiche « Renvoyée au formateur » ; le formateur auteur renvoie sa demande corrigée au Planning Tertiaire', async () => {
    afficher(FORMATEUR_TERTIAIRE, { statut: 'renvoyee_inspecteur' });
    expect(await screen.findByText('Renvoyée au formateur')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Renvoyer au Planning Tertiaire' }));
    const fenetre = await screen.findByRole('dialog');
    expect(within(fenetre).getByRole('heading', { name: 'Renvoyer la demande au Planning Tertiaire ?' })).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(dpaeService.envoyerAuPlanningDemande).toHaveBeenCalledWith('7', 3));
  });

  it('le formateur ne voit ni valider, ni rejeter, ni renvoyer sur sa demande', async () => {
    afficher(FORMATEUR_TERTIAIRE);
    await screen.findByText('notes de la demande');
    for (const nom of ['Valider', 'Rejeter', 'Mettre en attente', 'Renvoyer au formateur']) expect(bouton(nom), nom).toBeNull();
    expect(bouton('Classer sans suite')).toBeTruthy();
  });

  it('accès hors périmètre : le message du serveur est affiché tel quel à la place de la fiche', async () => {
    useSession.mockReturnValue({ utilisateur: RH, chargement: false });
    dpaeService.obtenirDemande.mockRejectedValue({ response: { status: 403, data: { erreur: "Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire." } } });
    render(
      <MemoryRouter initialEntries={['/rh/dpae/7']}>
        <Routes>
          <Route path="/rh/dpae/:demandeId" element={<DetailDemandeDpae />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByRole('alert')).textContent).toBe("Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire.");
  });
});
