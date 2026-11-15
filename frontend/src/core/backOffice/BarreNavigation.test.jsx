import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BarreNavigation, { decalageMenuVues } from './BarreNavigation';
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
    // Plus de sous-onglet de gestion des sites : le renommage se fait dans le formulaire.
    expect(libellesOnglets('Navigation DPAE').map(([libelle]) => libelle)).not.toContain('Sites du Tertiaire');
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

  test('navigation au clavier : flèche bas ouvre et place le focus sur la première vue ; haut/bas dans une colonne, gauche/droite d’une colonne à l’autre', async () => {
    afficher(sessionDe('admin'));
    const bouton = screen.getByRole('button', { name: /^Vues/ });
    fireEvent.keyDown(bouton, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Formateur Hôtellerie'));
    const menu = () => screen.getByRole('menu');
    fireEvent.keyDown(menu(), { key: 'ArrowDown' });
    expect(document.activeElement.textContent).toBe('Inspecteur Hôtellerie');
    // Bas depuis la dernière vue de la colonne : retour en haut de la MÊME colonne.
    fireEvent.keyDown(menu(), { key: 'ArrowDown' });
    expect(document.activeElement.textContent).toBe('Formateur Hôtellerie');
    fireEvent.keyDown(menu(), { key: 'ArrowUp' });
    expect(document.activeElement.textContent).toBe('Inspecteur Hôtellerie');
    fireEvent.keyDown(menu(), { key: 'Home' });
    expect(document.activeElement.textContent).toBe('Formateur Hôtellerie');
    fireEvent.keyDown(menu(), { key: 'End' });
    expect(document.activeElement.textContent).toBe('Inspecteur Hôtellerie');
    // Droite : colonne du Tertiaire, même rang ; gauche : retour.
    fireEvent.keyDown(menu(), { key: 'ArrowRight' });
    expect(document.activeElement.textContent).toBe('Planning Tertiaire');
    fireEvent.keyDown(menu(), { key: 'ArrowLeft' });
    expect(document.activeElement.textContent).toBe('Inspecteur Hôtellerie');
    fireEvent.keyDown(menu(), { key: 'Home' });
    fireEvent.keyDown(menu(), { key: 'ArrowRight' });
    expect(document.activeElement.textContent).toBe('Formateur Tertiaire');
  });

  test('deux colonnes côte à côte : Hôtellerie puis Tertiaire, chaque titre aux couleurs de son secteur (data-secteur)', () => {
    afficher(sessionDe('admin'));
    fireEvent.click(screen.getByRole('button', { name: /^Vues/ }));
    const groupes = within(screen.getByRole('menu')).getAllByRole('group');
    expect(groupes.map((groupe) => groupe.getAttribute('aria-label'))).toEqual(['Hôtellerie', 'Tertiaire']);
    expect(groupes.map((groupe) => groupe.querySelector('.barre-navigation__vues-secteur').dataset.secteur)).toEqual(['hotellerie', 'tertiaire']);
    expect(groupes[0].textContent).toContain('Formateur Hôtellerie');
    expect(groupes[1].textContent).toContain('Planning Tertiaire');
  });

  test('vue active : mise en évidence dans la colonne de son secteur', () => {
    afficher(sessionDe('admin'), '/vue-planning-tertiaire/dossiers');
    fireEvent.click(screen.getByRole('button', { name: /^Vues/ }));
    const actif = within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Planning Tertiaire' });
    expect(actif.className).toContain('barre-navigation__vues-option--actif');
    expect(actif.closest('[role="group"]').getAttribute('aria-label')).toBe('Tertiaire');
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Formateur Hôtellerie' }).className).not.toContain('--actif');
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

describe('Position du menu « Vues »', () => {
  const css = readFileSync('src/core/backOffice/BarreNavigation.css', 'utf8');

  test('bord gauche aligné sur le bouton : left 0 par défaut, jamais ancré à droite', () => {
    const regle = css.slice(css.indexOf('.barre-navigation__vues-menu {'), css.indexOf('}', css.indexOf('.barre-navigation__vues-menu {')));
    expect(regle).toMatch(/left:\s*0;/);
    expect(regle).not.toMatch(/right:/);
    expect(regle).toMatch(/top:\s*calc\(100% \+ 4px\)/);
  });

  test('titres de secteur : variables CSS des pastilles de la liste des dossiers (FiltreEntite.css), pas de couleur en dur', () => {
    const filtre = readFileSync('src/core/dossier/FiltreEntite.css', 'utf8');
    const titre = (secteur) => css.slice(css.indexOf(`.barre-navigation__vues-secteur[data-secteur='${secteur}']`)).split('}')[0];
    for (const variable of ['--couleur-primaire-clair', '--couleur-primaire', '--statut-dore-fond', '--statut-dore-bordure', '--statut-dore-texte']) {
      expect(filtre).toContain(variable);
      expect(titre(variable.startsWith('--statut-dore') ? 'tertiaire' : 'hotellerie')).toContain(variable);
    }
    expect(css).toMatch(/\.barre-navigation__vues-secteur \{[^}]*font-weight:\s*600/);
    expect(css).toMatch(/\.barre-navigation__vues-secteur \{[^}]*border-radius:/);
  });

  test('la classe des titres de secteur est réutilisée par le choix d’entité du formulaire : pastille en ligne, option choisie en évidence', () => {
    expect(css).toMatch(/\.barre-navigation__vues-secteur\[data-actif\] \{[^}]*display:\s*inline-flex/);
    expect(css).toMatch(/\.barre-navigation__vues-secteur\[data-actif='true'\] \{[^}]*border-color:\s*currentColor/);
    // Aucune classe supplémentaire pour les secteurs.
    expect(css.match(/\.barre-navigation__vues-secteur[^\s{[:]/g) ?? []).toEqual([]);
  });

  test('colonnes : flex côte à côte, séparation verticale, libellés sans retour à la ligne', () => {
    expect(css).toMatch(/\.barre-navigation__vues-menu \{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.barre-navigation__vues-menu \{[^}]*width:\s*max-content/);
    expect(css).toMatch(/\.barre-navigation__vues-groupe \+ \.barre-navigation__vues-groupe \{[^}]*border-left:/);
    expect(css).toMatch(/\.barre-navigation__vues-option \{[^}]*white-space:\s*nowrap/);
  });

  test('décalage : aucun si le menu tient (1920 px), juste ce qu’il faut vers la gauche sinon (1280 px), jamais au-delà du bord gauche', () => {
    // Bouton « Vues : Planning Tertiaire ▾ » à droite de la barre, menu de 440 px.
    expect(decalageMenuVues({ gaucheBouton: 1000, largeurMenu: 440, largeurFenetre: 1920 })).toBe(0);
    expect(decalageMenuVues({ gaucheBouton: 1000, largeurMenu: 440, largeurFenetre: 1280 })).toBe(-(1000 + 440 - (1280 - 8)));
    // Tient exactement : pas de décalage.
    expect(decalageMenuVues({ gaucheBouton: 832, largeurMenu: 440, largeurFenetre: 1280 })).toBe(0);
    // Après décalage, le menu reste entièrement visible.
    const decalage = decalageMenuVues({ gaucheBouton: 1000, largeurMenu: 440, largeurFenetre: 1280 });
    expect(1000 + decalage + 440).toBeLessThanOrEqual(1280 - 8);
    // Fenêtre plus étroite que le menu : s'arrête à la marge gauche.
    expect(1000 + decalageMenuVues({ gaucheBouton: 1000, largeurMenu: 440, largeurFenetre: 300 })).toBe(8);
  });
});
