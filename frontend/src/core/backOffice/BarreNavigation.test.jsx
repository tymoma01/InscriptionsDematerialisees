import { createRequire } from 'node:module';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BarreNavigation from './BarreNavigation';
import { ROLES_VUES } from '../referentiels/rolesVues';
import { useSession } from '../auth/useSession';

vi.mock('../auth/useSession', () => ({ useSession: vi.fn() }));

afterEach(cleanup);

function afficher(utilisateur, chemin = '/accueil/tableau-de-bord') {
  useSession.mockReturnValue({ utilisateur, chargement: false });
  render(
    <MemoryRouter initialEntries={[chemin]}>
      <BarreNavigation />
    </MemoryRouter>,
  );
}

function libellesOnglets(nom = 'Navigation back-office') {
  return within(screen.getByRole('navigation', { name: nom }))
    .getAllByRole('link')
    .map((lien) => [lien.textContent, lien.getAttribute('href')]);
}

describe('BarreNavigation', () => {
  test('les onglets suivent les permissions reçues avec la session', () => {
    afficher({ roleCode: 'planning', permissions: ['statistiques', 'listeDossiers', 'suiviTests', 'dpaeConsultation'] });
    expect(libellesOnglets().map(([libelle]) => libelle)).toEqual(['Tableau de bord', 'Dossiers candidats', 'Suivi des tests', 'DPAE']);
  });

  test('Formateur : son propre espace, désigné par son rôle', () => {
    afficher({ roleCode: 'inspecteur', permissions: ['suiviTests'] }, '/inspecteur/evaluations');
    expect(libellesOnglets()).toEqual([
      ['Historique des évaluations', '/inspecteur/historique'],
      ['Évaluations à venir', '/inspecteur/evaluations'],
      ['Suivi des tests', '/coordination/planification'],
    ]);
  });

  test('RH : « Tableau de bord DPAE » par défaut et en premier sous-onglet', () => {
    afficher({ roleCode: 'rh', permissions: ['dpaeConsultation', 'dpaeTableauDeBord', 'dpaeTraitementRh'] }, '/rh/dpae');
    expect(libellesOnglets()).toContainEqual(['DPAE', '/coordination/dpae/tableau-de-bord']);
    expect(libellesOnglets('Navigation DPAE')).toEqual([
      ['Tableau de bord DPAE', '/coordination/dpae/tableau-de-bord'],
      ['Demandes DPAE', '/rh/dpae'],
    ]);
  });

  test('sans le tableau de bord DPAE (Inspecteur) : « DPAE » ouvre les demandes, seul sous-onglet', () => {
    afficher({ roleCode: 'inspecteur_hotellerie', permissions: ['dpaeConsultation'] }, '/coordination/dpae/suivi');
    expect(libellesOnglets()).toContainEqual(['DPAE', '/coordination/dpae/suivi']);
    expect(libellesOnglets('Navigation DPAE')).toEqual([['Demandes DPAE', '/coordination/dpae/suivi']]);
  });

  test('rien n’est affiché sans session', () => {
    useSession.mockReturnValue({ utilisateur: null, chargement: false });
    const { container } = render(
      <MemoryRouter>
        <BarreNavigation />
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe('');
  });
});

// Permissions réelles du serveur (source unique, backend/src/core/auth/permissions.js).
const require = createRequire(import.meta.url);
const { permissionsDuRole } = require('../../../../backend/src/core/auth/permissions.js');
const sessionDe = (roleCode) => ({ roleCode, permissions: permissionsDuRole(roleCode) });

describe('BarreNavigation : Planning Tertiaire', () => {
  test('« Suivi des formations » absent du menu du Planning Tertiaire, présent pour le Planning Hôtellerie', () => {
    afficher(sessionDe('planning_tertiaire'));
    const tertiaire = libellesOnglets().map(([libelle]) => libelle);
    expect(tertiaire).not.toContain('Suivi des formations');
    expect(tertiaire).toEqual(expect.arrayContaining(['Dossiers candidats', 'Suivi des tests', 'DPAE']));
    cleanup();
    afficher(sessionDe('planning'));
    expect(libellesOnglets().map(([libelle]) => libelle)).toContain('Suivi des formations');
  });

  test('l’onglet DPAE du Planning Tertiaire ouvre le tableau de bord, « Demandes DPAE » est sa file de traitement', () => {
    afficher(sessionDe('planning_tertiaire'), '/rh/dpae');
    expect(libellesOnglets('Navigation DPAE')).toEqual([
      ['Tableau de bord DPAE', '/coordination/dpae/tableau-de-bord'],
      ['Demandes à valider', '/coordination/dpae/a-valider'],
      ['Demandes DPAE', '/rh/dpae'],
    ]);
  });
});

// Entrées de la barre principale dans l'ordre (liens ET bouton « Vues »).
const entreesBarre = () => [...screen.getByRole('navigation', { name: 'Navigation back-office' }).children].map((noeud) => noeud.textContent.replace(/\s+/g, ' ').trim());

describe('BarreNavigation : menu « Vues » de l’Admin', () => {
  test('la barre de l’Admin contient les 7 entrées dans l’ordre, « Vues » en dernier', () => {
    afficher(sessionDe('admin'));
    expect(entreesBarre()).toEqual(['Tableau de bord', 'Dossiers candidats', 'Suivi des tests', 'Suivi des formations', 'DPAE', 'Comptes utilisateurs', 'Vues ▾']);
  });

  test('le menu liste chaque vue existante, regroupée par secteur, et ouvre la vue choisie', () => {
    afficher(sessionDe('admin'));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Vues/ }));
    const menu = screen.getByRole('menu', { name: 'Vues par rôle' });
    const hotellerie = within(menu).getByRole('group', { name: 'Hôtellerie' });
    const tertiaire = within(menu).getByRole('group', { name: 'Tertiaire' });
    expect(within(hotellerie).getAllByRole('menuitem').map((lien) => [lien.textContent, lien.getAttribute('href')])).toEqual([
      ['Formateur Hôtellerie', '/formateur/evaluations'],
      ['Inspecteur Hôtellerie', '/vue-inspecteur-hotellerie/dossiers'],
    ]);
    expect(within(tertiaire).getAllByRole('menuitem').map((lien) => [lien.textContent, lien.getAttribute('href')])).toEqual([
      ['Formateur Tertiaire', '/inspecteur/evaluations'],
      ['Planning Tertiaire', '/vue-planning-tertiaire/dossiers'],
    ]);
    // Choisir une vue ferme le menu.
    fireEvent.click(within(tertiaire).getByRole('menuitem', { name: 'Planning Tertiaire' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('vue ouverte : le bouton est mis en évidence comme un onglet actif et affiche le nom de la vue', () => {
    afficher(sessionDe('admin'), '/vue-planning-tertiaire/dossiers');
    const bouton = screen.getByRole('button', { name: /^Vues : Planning Tertiaire/ });
    expect(bouton.className).toContain('barre-navigation__lien--actif');
    cleanup();
    afficher(sessionDe('admin'), '/inspecteur/evaluations');
    expect(screen.getByRole('button', { name: /^Vues : Formateur Tertiaire/ })).toBeTruthy();
    // Les sous-onglets de l'espace du rôle restent proposés.
    expect(libellesOnglets('Navigation Formateur Tertiaire').map(([libelle]) => libelle)).toEqual(['Historique des évaluations', 'Évaluations à venir']);
    cleanup();
    afficher(sessionDe('admin'), '/accueil/tableau-de-bord');
    expect(screen.getByRole('button', { name: 'Vues' }).className).not.toContain('--actif');
  });

  test('un rôle ajouté à la définition des rôles apparaît dans le menu ; un rôle sans vue n’y figure pas', () => {
    const rolesVues = [
      ...ROLES_VUES,
      { code: 'nouveau_role', libelle: 'Nouveau rôle', secteur: 'tertiaire', vue: { chemin: '/vue-nouveau/dossiers', estActif: (chemin) => chemin.startsWith('/vue-nouveau/') } },
      { code: 'sans_vue', libelle: 'Rôle sans vue', secteur: 'tertiaire', vue: null },
    ];
    useSession.mockReturnValue({ utilisateur: sessionDe('admin'), chargement: false });
    render(
      <MemoryRouter initialEntries={['/accueil/tableau-de-bord']}>
        <BarreNavigation rolesVues={rolesVues} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Vues/ }));
    const noms = within(screen.getByRole('menu')).getAllByRole('menuitem').map((lien) => lien.textContent);
    expect(noms).toContain('Nouveau rôle');
    expect(noms).not.toContain('Rôle sans vue');
    expect(noms).not.toContain('Planning Hôtellerie');
  });

  test('le menu se ferme avec Échap (focus rendu au bouton) et au clic extérieur', () => {
    afficher(sessionDe('admin'));
    const bouton = screen.getByRole('button', { name: /^Vues/ });
    fireEvent.click(bouton);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(bouton);
    fireEvent.click(bouton);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('navigation au clavier : flèche bas ouvre et place le focus sur la première vue, flèches et Fin parcourent le menu', async () => {
    afficher(sessionDe('admin'));
    const bouton = screen.getByRole('button', { name: /^Vues/ });
    fireEvent.keyDown(bouton, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Formateur Hôtellerie'));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement.textContent).toBe('Inspecteur Hôtellerie');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(document.activeElement.textContent).toBe('Planning Tertiaire');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement.textContent).toBe('Formateur Hôtellerie');
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(document.activeElement.textContent).toBe('Planning Tertiaire');
  });

  test('les autres rôles ne voient pas « Vues »', () => {
    for (const roleCode of ['rh', 'planning', 'planning_tertiaire', 'accueil_coordination', 'formateur', 'inspecteur', 'inspecteur_hotellerie']) {
      afficher(sessionDe(roleCode));
      expect(screen.queryByRole('button', { name: /^Vues/ }), roleCode).toBeNull();
      cleanup();
    }
  });

  test('l’onglet s’appelle « DPAE » pour tous les rôles qui y ont accès', () => {
    for (const roleCode of ['rh', 'planning', 'planning_tertiaire', 'admin', 'inspecteur_hotellerie', 'inspecteur']) {
      afficher(sessionDe(roleCode));
      expect(entreesBarre(), roleCode).toContain('DPAE');
      expect(entreesBarre(), roleCode).not.toContain('RH');
      cleanup();
    }
  });
});
