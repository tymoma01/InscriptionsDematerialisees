import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BarreNavigation from './BarreNavigation';
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
    expect(libellesOnglets().map(([libelle]) => libelle)).toEqual(['Tableau de bord', 'Dossiers candidats', 'Suivi des tests', 'RH']);
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
    expect(libellesOnglets()).toContainEqual(['RH', '/coordination/dpae/tableau-de-bord']);
    expect(libellesOnglets('Navigation RH')).toEqual([
      ['Tableau de bord DPAE', '/coordination/dpae/tableau-de-bord'],
      ['Demandes DPAE', '/rh/dpae'],
    ]);
  });

  test('sans le tableau de bord DPAE (Inspecteur) : « RH » ouvre les demandes, seul sous-onglet', () => {
    afficher({ roleCode: 'inspecteur_hotellerie', permissions: ['dpaeConsultation'] }, '/coordination/dpae/suivi');
    expect(libellesOnglets()).toContainEqual(['RH', '/coordination/dpae/suivi']);
    expect(libellesOnglets('Navigation RH')).toEqual([['Demandes DPAE', '/coordination/dpae/suivi']]);
  });

  test('Admin : onglets Formateur Hôtellerie, Formateur Tertiaire et Inspecteur, sans « Vue »', () => {
    afficher({ roleCode: 'admin', permissions: ['administration'] });
    expect(libellesOnglets().map(([libelle]) => libelle)).toEqual([
      'Formateur Hôtellerie',
      'Formateur Tertiaire',
      'Inspecteur',
      'Comptes utilisateurs',
    ]);
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
