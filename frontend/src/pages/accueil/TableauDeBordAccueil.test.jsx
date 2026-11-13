// Liste « Dossiers candidats » et vue Inspecteur Hôtellerie : même composant, mêmes pastilles de
// statut ; « Blacklisté » exclu de « Tous » et des autres compteurs.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const etat = { utilisateur: null, dossiers: [], statuts: [] };

vi.mock('../../core/auth/useSession', () => ({ useSession: () => ({ utilisateur: etat.utilisateur, chargement: false }) }));
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));
vi.mock('../../core/dossier/useRafraichissementAuto', () => ({ useRafraichissementAuto: vi.fn() }));
vi.mock('../../services/dossierService', () => ({
  listerDossiers: vi.fn(async () => etat.dossiers),
  listerStatuts: vi.fn(async () => etat.statuts),
  corrigerDisponibiliteEmbauche: vi.fn(),
}));

import TableauDeBordAccueil from './TableauDeBordAccueil';
import { listerDossiers } from '../../services/dossierService';

const STATUTS = [
  ['nouveau', 'Inscrit'],
  ['en_attente_pieces', 'En attente de pièces'],
  ['test_non_planifie', 'Test non planifié'],
  ['test_planifie', 'Test planifié'],
  ['test_realise', 'Test réalisé'],
  ['test_non_realise', 'Test non réalisé'],
  ['invalide', 'Invalidé'],
  ['valide_envoi_formation', 'Validé - envoyé en formation'],
  ['valide_pret_embauche', "Validé - prêt à l'embauche"],
  ['formation_non_validee', 'Formation non validée'],
  ['embauche', 'Embauché'],
  ['blackliste', 'Blacklisté'],
].map(([code, libelle], index) => ({ code, libelle, ordre: (index + 1) * 10 }));

const dossier = (id, statut) => ({
  id,
  statut_code: statut,
  statut_libelle: statut,
  candidat_nom: `Nom${id}`,
  candidat_prenom: `Prenom${id}`,
  postesHotel: ['serveur'],
  postesBureau: [],
  date_maj: '2026-11-01T10:00:00Z',
});

function libellesPastillesStatut() {
  const nav = screen.getByRole('navigation', { name: 'Filtrer par statut' });
  return within(nav)
    .getAllByRole('button')
    .map((bouton) => bouton.textContent.replace(/\s*\(\d+\)\s*$/, ''));
}

function compteurDe(libelle) {
  const nav = screen.getByRole('navigation', { name: 'Filtrer par statut' });
  const bouton = within(nav)
    .getAllByRole('button')
    .find((b) => b.textContent.replace(/\s*\(\d+\)\s*$/, '') === libelle);
  return Number(/\((\d+)\)/.exec(bouton.textContent)[1]);
}

function afficher(props = {}) {
  return render(
    <MemoryRouter>
      <TableauDeBordAccueil {...props} />
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  etat.statuts = STATUTS;
  etat.dossiers = [dossier(1, 'test_planifie'), dossier(2, 'test_planifie'), dossier(3, 'blackliste')];
});

test('même liste et même ordre de pastilles de statut pour Accueil et pour la vue Inspecteur, dont les statuts à 0', async () => {
  etat.utilisateur = { roleCode: 'accueil_coordination', permissions: ['listeDossiers'] };
  const accueil = afficher();
  await screen.findByText('Nom1', { exact: false });
  const pastillesAccueil = libellesPastillesStatut();
  cleanup();

  etat.utilisateur = { roleCode: 'inspecteur_hotellerie', permissions: ['listeDossiers'] };
  afficher();
  await screen.findByText('Nom1', { exact: false });
  expect(libellesPastillesStatut()).toEqual(pastillesAccueil);
  expect(pastillesAccueil).toContain('Blacklisté');
  expect(pastillesAccueil).toContain('À planifier');
  expect(compteurDe('Inscrit')).toBe(0);
  expect(accueil).toBeTruthy();
});

test('vue Inspecteur : le dossier blacklisté est exclu de « Tous » et visible via « Blacklisté »', async () => {
  etat.utilisateur = { roleCode: 'inspecteur_hotellerie', permissions: ['listeDossiers'] };
  afficher();
  await screen.findByText('Nom1', { exact: false });
  expect(compteurDe('Blacklisté')).toBe(1);
  expect(compteurDe('Test planifié')).toBe(2);
  expect(screen.getByRole('button', { name: /^Tous/ }).textContent).toContain('(2)');
  expect(screen.queryByText('Nom3', { exact: false })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /^Blacklisté/ }));
  await waitFor(() => expect(screen.getByText('Nom3', { exact: false })).toBeTruthy());
  expect(screen.queryByText('Nom1', { exact: false })).toBeNull();
});

test('compteurs mis à jour après un changement de statut, sans rechargement de la page', async () => {
  etat.utilisateur = { roleCode: 'accueil_coordination', permissions: ['listeDossiers'] };
  const { rerender } = afficher();
  await screen.findByText('Nom1', { exact: false });
  expect(compteurDe('Blacklisté')).toBe(1);

  // Blacklistage du dossier 1 : le rafraîchissement automatique recharge la liste.
  const { useRafraichissementAuto } = await import('../../core/dossier/useRafraichissementAuto');
  const rafraichir = useRafraichissementAuto.mock.calls.at(-1)[0];
  etat.dossiers = [dossier(1, 'blackliste'), dossier(2, 'test_planifie'), dossier(3, 'blackliste')];
  rafraichir();
  await waitFor(() => expect(compteurDe('Blacklisté')).toBe(2));
  expect(compteurDe('Test planifié')).toBe(1);
  expect(screen.getByRole('button', { name: /^Tous/ }).textContent).toContain('(1)');
  expect(listerDossiers).toHaveBeenCalledTimes(2);
  expect(rerender).toBeTruthy();
});
