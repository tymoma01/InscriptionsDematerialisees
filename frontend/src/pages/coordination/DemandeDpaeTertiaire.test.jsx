import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DemandeDpae from './DemandeDpae';
import { useSession } from '../../core/auth/useSession';
import { obtenirConfigurationDpae } from '../../services/dpaeService';

vi.mock('../../core/auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dpaeService', () => ({ creerDemande: vi.fn(), modifierDemande: vi.fn(), obtenirDemande: vi.fn(), listerNotesDemande: vi.fn(), obtenirConfigurationDpae: vi.fn() }));
vi.mock('../../services/siteAffectationService', () => ({
  listerSitesAffectation: vi.fn().mockResolvedValue([{ id: 10, nom: 'AIGLON', initiales: 'AIG', actif: true }]),
  creerSiteAffectation: vi.fn(),
}));
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));

const CONFIGURATION = {
  echelonsParPoste: { equipier: ['AS', 'ATQS'], autre: ['AS', 'ATQS'] },
  echelonsParPosteTertiaire: {},
  postesTertiaire: ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autre'],
};

function afficher(roleCode, entiteImposee) {
  useSession.mockReturnValue({ utilisateur: { roleCode, permissions: ['dpaeCreation'] }, chargement: false });
  obtenirConfigurationDpae.mockResolvedValue({ ...CONFIGURATION, entiteImposee });
  render(
    <MemoryRouter>
      <DemandeDpae />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const selectEntite = () => screen.getByLabelText('Entité');
const selectPoste = () => screen.getByLabelText(/^Poste/);
const optionsDe = (select) => within(select).getAllByRole('option').map((option) => option.textContent);

describe('Formulaire de demande DPAE : entité du rôle', () => {
  it.each([
    ['inspecteur', 'Formateur Tertiaire'],
    ['planning_tertiaire', 'Planning Tertiaire'],
  ])('%s : l’entité est fixée à « Tertiaire » et non modifiable ; seuls les postes du Tertiaire sont proposés', async (roleCode) => {
    afficher(roleCode, 'tertiaire');
    await waitFor(() => expect(optionsDe(selectPoste())).toEqual(['Choisir…', 'Nettoyage', 'Vitrerie', 'Machiniste', "Chef d'équipe", 'Autre']), { timeout: 4000 });
    expect(selectEntite().value).toBe('tertiaire');
    expect(selectEntite().disabled).toBe(true);
    expect(optionsDe(selectEntite())).toEqual(['Tertiaire']);
    expect(screen.getByRole('button', { name: /Envoyer au Planning Tertiaire/ })).toBeTruthy();
  });

  it('Tertiaire : aucun échelon proposé (liste vide dans la configuration, section masquée)', async () => {
    afficher('inspecteur', 'tertiaire');
    await waitFor(() => expect(optionsDe(selectPoste())).toContain('Nettoyage'));
    fireEvent.change(selectPoste(), { target: { value: 'autre' } });
    expect(screen.queryByText('Échelon')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'AS' })).toBeNull();
  });

  it('rôle de l’Hôtellerie : postes de l’Hôtellerie, pas de choix « Tertiaire », échelons de l’Hôtellerie inchangés', async () => {
    afficher('inspecteur_hotellerie', 'hotellerie');
    await waitFor(() => expect(optionsDe(selectEntite())).toEqual(['Choisir…', 'Hôtellerie', 'Autre']));
    expect(optionsDe(selectPoste())).toEqual(['Choisir…', 'Femme/Valet de chambre', 'Cafetier', 'Équipier', 'Gouvernant(e)', 'Autre']);
    fireEvent.change(selectPoste(), { target: { value: 'equipier' } });
    expect(screen.getByRole('radio', { name: 'AS' })).toBeTruthy();
  });

  it('Admin : entité libre ; le choix « Tertiaire » bascule les postes sur ceux du Tertiaire', async () => {
    afficher('admin', null);
    await waitFor(() => expect(optionsDe(selectEntite())).toEqual(['Choisir…', 'Hôtellerie', 'Tertiaire', 'Autre']));
    expect(selectEntite().disabled).toBe(false);
    fireEvent.change(selectEntite(), { target: { value: 'tertiaire' } });
    await waitFor(() => expect(optionsDe(selectPoste())).toContain('Nettoyage'));
    expect(optionsDe(selectPoste())).not.toContain('Équipier');
  });
});
