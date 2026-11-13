// Composant unique de blacklistage : visibilité selon le rôle et le statut, messages du serveur affichés
// tels quels (fenêtre ouverte), blacklistage depuis la fiche et depuis l'évaluation.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const etat = { utilisateur: null, dossier: null };

vi.mock('../auth/useSession', () => ({ useSession: () => ({ utilisateur: etat.utilisateur }) }));
vi.mock('../../services/dossierService', () => ({ obtenirDossier: vi.fn(async () => etat.dossier) }));
vi.mock('../../services/transitionService', () => ({
  blacklisterDossier: vi.fn(),
  retirerBlacklistDossier: vi.fn(),
  listerCategoriesBlacklist: vi.fn(async () => [{ code: 'autre', libelle: 'Autre' }]),
}));

import BoutonBlacklister, { affichageBlacklistPourDossier } from './BoutonBlacklister';
import NavigationFicheDossier from './NavigationFicheDossier';
import { blacklisterDossier, retirerBlacklistDossier } from '../../services/transitionService';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  blacklisterDossier.mockResolvedValue({});
});

// Miroir de backend/src/core/auth/permissions.js pour les clés concernées.
const BACK_OFFICE = ['accueil_coordination', 'planning', 'formateur', 'inspecteur', 'inspecteur_hotellerie', 'admin', 'rh'];
const EMBAUCHE_AUTORISE = ['planning', 'rh', 'admin'];
function utilisateurRole(role) {
  const permissions = ['blacklister', 'lectureInscription'];
  if (EMBAUCHE_AUTORISE.includes(role)) permissions.push('blacklisterEmbauche');
  if (role === 'admin') permissions.push('retirerBlacklist');
  return { roleCode: role, permissions };
}
const dossierAu = (statut) => ({ id: 5, statut_code: statut, candidat_nom: 'Durand', candidat_prenom: 'Paul', rendezvousActifs: [], statutAvantBlacklist: { libelle: 'Test planifié' } });

test('candidat non embauché : visible pour chaque rôle du back-office', () => {
  for (const role of BACK_OFFICE) expect(affichageBlacklistPourDossier(utilisateurRole(role), 'test_planifie'), role).toBe('blacklister');
});

test('candidat embauché : visible seulement pour Planning, RH et Admin', () => {
  for (const role of BACK_OFFICE) {
    expect(affichageBlacklistPourDossier(utilisateurRole(role), 'embauche'), role).toBe(EMBAUCHE_AUTORISE.includes(role) ? 'blacklister' : null);
  }
});

test('candidat blacklisté : pastille pour tous, « Retirer de la blacklist » pour l’Admin seul', () => {
  for (const role of BACK_OFFICE) {
    expect(affichageBlacklistPourDossier(utilisateurRole(role), 'blackliste'), role).toBe(role === 'admin' ? 'retirer' : 'blackliste');
  }
});

async function afficher(role, statut, props = {}) {
  etat.utilisateur = utilisateurRole(role);
  etat.dossier = dossierAu(statut);
  render(<BoutonBlacklister dossierId="5" apresChangement={() => {}} {...props} />);
  await waitFor(() => expect(document.body.innerHTML).not.toBe(''));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('rendu : bouton pour un rôle autorisé, rien pour un formateur sur un dossier embauché', async () => {
  await afficher('formateur', 'embauche');
  expect(screen.queryByRole('button')).toBeNull();
  cleanup();
  await afficher('planning', 'embauche');
  expect(screen.getByRole('button', { name: 'Blacklister' })).toBeTruthy();
});

test('rendu : dossier blacklisté, pastille « Blacklisté » sans bouton pour un non-Admin, avec retrait pour l’Admin', async () => {
  await afficher('rh', 'blackliste');
  expect(screen.getByText('Blacklisté')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  cleanup();
  await afficher('admin', 'blackliste');
  expect(screen.getByText('Blacklisté')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retirer de la blacklist' })).toBeTruthy();
});

test('fiche du dossier : le bouton est dans la barre d’onglets, pour chaque rôle et chaque onglet', async () => {
  for (const role of BACK_OFFICE) {
    for (const page of ['validation', 'pieces', 'tests', 'relances', 'formation']) {
      etat.utilisateur = { ...utilisateurRole(role), permissions: [...utilisateurRole(role).permissions, 'gestionPieces', 'lectureRendezvous', 'lectureRelances', 'lectureFormation'] };
      etat.dossier = dossierAu('test_planifie');
      render(<MemoryRouter><NavigationFicheDossier dossierId="5" pageActuelle={page} /></MemoryRouter>);
      const bouton = await screen.findByRole('button', { name: 'Blacklister' });
      expect(bouton.closest('nav')?.getAttribute('aria-label'), `${role}/${page}`).toBe('Sections du dossier');
      cleanup();
    }
  }
});

const MESSAGES = [
  ['blacklister', 'Ce candidat est embauché : seuls les rôles Planning, RH et Admin peuvent le blacklister.'],
  ['blacklister', 'Ce candidat est déjà blacklisté depuis le 03/11/2026 par Jeanne Dupont.'],
  ['blacklister', "Le motif est obligatoire : choisissez une catégorie et saisissez un commentaire d'au moins 10 caractères."],
  ['retirer', 'Seul un administrateur peut retirer un candidat de la blacklist.'],
];

for (const [action, message] of MESSAGES) {
  test(`message du serveur affiché tel quel, fenêtre non fermée : « ${message.slice(0, 40)}… »`, async () => {
    const echec = Object.assign(new Error('x'), { response: { status: 400, data: { erreur: message } } });
    (action === 'retirer' ? retirerBlacklistDossier : blacklisterDossier).mockRejectedValue(echec);
    etat.utilisateur = utilisateurRole('admin');
    etat.dossier = dossierAu(action === 'retirer' ? 'blackliste' : 'test_planifie');

    render(<BoutonBlacklister dossierId="5" apresChangement={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: action === 'retirer' ? 'Retirer de la blacklist' : 'Blacklister' }));
    if (action === 'blacklister') fireEvent.click(await screen.findByLabelText('Autre'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Commentaire factuel suffisant.' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: action === 'retirer' ? 'Retirer de la blacklist' : 'Confirmer le blacklistage' }));

    expect((await screen.findByText(message)).textContent).toBe(message);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
}

async function blacklister(rendu) {
  fireEvent.click(await screen.findByRole('button', { name: 'Blacklister' }));
  fireEvent.click(await screen.findByLabelText('Autre'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Absent trois fois sans prévenir.' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirmer le blacklistage' }));
  await waitFor(() => expect(blacklisterDossier).toHaveBeenCalled());
  return rendu;
}

test('évaluation en cours : la fenêtre prévient de l’abandon, puis retour à la liste ; même appel API que la fiche', async () => {
  etat.utilisateur = utilisateurRole('formateur');
  etat.dossier = dossierAu('test_planifie');
  const retourListe = vi.fn();
  render(<BoutonBlacklister dossierId="5" avertissement="L’évaluation en cours, non enregistrée, sera abandonnée." apresChangement={retourListe} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Blacklister' }));
  expect(screen.getByText(/sera abandonnée/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  await blacklister();
  await waitFor(() => expect(retourListe).toHaveBeenCalled());
  const appelEvaluation = blacklisterDossier.mock.calls[0];
  cleanup();
  vi.clearAllMocks();
  blacklisterDossier.mockResolvedValue({});

  // Fiche du dossier : même API, mêmes arguments -> la même note est créée côté serveur.
  render(<MemoryRouter><NavigationFicheDossier dossierId="5" pageActuelle="validation" apresChangement={() => {}} /></MemoryRouter>);
  await blacklister();
  expect(blacklisterDossier.mock.calls[0]).toEqual(appelEvaluation);
  expect(appelEvaluation).toEqual(['5', { motifCode: 'autre', commentaire: 'Absent trois fois sans prévenir.' }]);
});
