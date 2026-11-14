import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DemandeDpae from './DemandeDpae';
import { useSession } from '../../core/auth/useSession';
import { obtenirConfigurationDpae, obtenirDemande, listerNotesDemande } from '../../services/dpaeService';

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
  tertiaire: {
    libelleDateDebut: 'Date d’embauche (ou journée de doublon)',
    typesDemande: [{ code: 'nouvelle_embauche', libelle: 'Nouvelle embauche' }],
    typesContrat: ['cdd', 'cdi'],
    motifsCdd: [
      { code: 'surcroit_activite', libelle: 'Surcroît d’activité' },
      { code: 'remplacement_absent', libelle: 'Remplacement d’un salarié' },
    ],
    limiteTexte: 100,
    qualifications: [
      { code: 'agent_service', libelle: 'Agent de service', echelons: ['AS1', 'AS2', 'AS3'] },
      { code: 'chef_equipe', libelle: 'Chef d’équipe', echelons: ['CE1', 'CE2', 'CE3'] },
    ],
  },
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

describe('Formulaire de demande DPAE : choix de l’entité', () => {
  it('premier choix de la page : sous le titre, avant tous les blocs (Admin)', async () => {
    afficher('admin', null);
    const groupe = await screen.findByRole('group', { name: 'Entité de la demande' }, { timeout: 4000 });
    const titre = screen.getByRole('heading', { name: 'Nouvelle demande DPAE' });
    const blocs = [...document.querySelectorAll('form > fieldset')];
    expect(blocs[0]).toBe(groupe);
    expect(titre.compareDocumentPosition(groupe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Plus dans « Informations de saisie ».
    expect(within(screen.getByText('Informations de saisie').closest('fieldset')).queryByText('Entité de la demande')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Hôtellerie' }).checked).toBe(true);
  });

  it.each([
    ['planning_tertiaire', 'tertiaire', 'Entité : Tertiaire'],
    ['inspecteur', 'tertiaire', 'Entité : Tertiaire'],
    ['inspecteur_hotellerie', 'hotellerie', 'Entité : Hôtellerie'],
  ])('%s : entité fixe, simple mention en lecture seule, sans boutons radio', async (roleCode, imposee, mention) => {
    afficher(roleCode, imposee);
    expect(await screen.findByText(mention, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Tertiaire' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Hôtellerie' })).toBeNull();
    expect(screen.queryByText('Entité de la demande')).toBeNull();
  });

  it('changement d’entité sans rien de renseigné : appliqué tout de suite, sans confirmation', async () => {
    afficher('admin', null);
    fireEvent.click(await screen.findByRole('radio', { name: 'Tertiaire' }, { timeout: 4000 }));
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('changement d’entité après saisie : confirmation, annuler conserve, confirmer réinitialise les champs propres à l’entité', async () => {
    afficher('admin', null);
    await screen.findByRole('radio', { name: 'Tertiaire' }, { timeout: 4000 });
    fireEvent.change(selectPoste(), { target: { value: 'equipier' } });
    fireEvent.change(screen.getByLabelText(/Prénom/), { target: { value: 'Léa' } });

    fireEvent.click(screen.getByRole('radio', { name: 'Tertiaire' }));
    let fenetre = await screen.findByRole('dialog');
    expect(within(fenetre).getByText(/seront réinitialisés/)).toBeTruthy();
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(selectPoste().value).toBe('equipier');
    expect(screen.getByRole('radio', { name: 'Hôtellerie' }).checked).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Tertiaire' }));
    fenetre = await screen.findByRole('dialog');
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy());
    expect(screen.getByLabelText(/^Catégorie/).value).toBe('');
    // L'identité du salarié est conservée.
    expect(screen.getByLabelText(/Prénom/).value).toBe('Léa');
  });

  it('même règle en modification d’une demande : l’Admin change l’entité, un rôle à entité fixe voit la mention', async () => {
    obtenirDemande.mockResolvedValue({ id: 7, version: 1, statut: 'envoyee', division: 'tertiaire', type_demande: 'nouvelle_embauche', salarie_nom: 'Martin', salarie_prenom: 'Léa', type_contrat: 'cdi', poste: 'chef_equipe', echelon: 'CE1', date_debut: '2026-11-02', sites_affectation: [{ id: 4, nom: 'Tour' }], semaine_type: [] });
    listerNotesDemande.mockResolvedValue([]);
    const rendre = (roleCode, imposee) => {
      useSession.mockReturnValue({ utilisateur: { roleCode, permissions: ['dpaeCreation', 'dpaeModification'] }, chargement: false });
      obtenirConfigurationDpae.mockResolvedValue({ ...CONFIGURATION, entiteImposee: imposee });
      render(
        <MemoryRouter initialEntries={['/coordination/dpae/7/modifier']}>
          <Routes>
            <Route path="/coordination/dpae/:demandeId/modifier" element={<DemandeDpae />} />
          </Routes>
        </MemoryRouter>,
      );
    };
    rendre('admin', null);
    const radio = await screen.findByRole('radio', { name: 'Tertiaire' }, { timeout: 4000 });
    expect(radio.checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Hôtellerie' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    cleanup();
    rendre('planning_tertiaire', 'tertiaire');
    expect(await screen.findByText('Entité : Tertiaire', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Hôtellerie' })).toBeNull();
  });
});

describe('Formulaire de demande DPAE : type de demande', () => {
  it('Tertiaire : « Nouvelle embauche » seule, préremplie et en lecture seule (pas de liste, pas de « Choisir… »)', async () => {
    afficher('planning_tertiaire', 'tertiaire');
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy(), { timeout: 4000 });
    const champ = screen.getByLabelText(/Il s’agit de/);
    expect(champ.tagName).toBe('INPUT');
    expect(champ.readOnly).toBe(true);
    expect(champ.value).toBe('Nouvelle embauche');
    expect(screen.queryByRole('option', { name: 'Prolongation' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /Il s’agit de/ })).toBeNull();
  });

  it('Hôtellerie inchangée : tous les types restent proposés', async () => {
    afficher('planning', 'hotellerie');
    await waitFor(() => expect(optionsDe(selectEntite())).toContain('Hôtellerie'), { timeout: 4000 });
    expect(optionsDe(screen.getByLabelText(/Il s’agit de/))).toEqual(['Choisir…', 'Nouvelle embauche', 'Prolongation', 'Ajout/retrait de jours', 'Passage CDI', 'Avenant']);
  });
});

describe('Formulaire de demande DPAE : entité du rôle', () => {
  it.each(['inspecteur', 'planning_tertiaire'])('%s : formulaire du Tertiaire, sans entité à choisir ; catégories de qualification de la configuration', async (roleCode) => {
    afficher(roleCode, 'tertiaire');
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy(), { timeout: 4000 });
    expect(optionsDe(screen.getByLabelText(/^Catégorie/))).toEqual(['Choisir…', 'Agent de service', 'Chef d’équipe']);
    // Entité fixée : ni choix d'entité ni question propre à l'Hôtellerie.
    expect(screen.queryByLabelText('Entité')).toBeNull();
    expect(screen.queryByText('Entité de la demande')).toBeNull();
    expect(screen.queryByText(/A déjà travaillé chez nous/)).toBeNull();
    expect(screen.queryByText(/J’ai vérifié le besoin|J.ai vérifié le besoin/)).toBeNull();
    expect(screen.getByRole('button', { name: /Envoyer au Planning Tertiaire/ })).toBeTruthy();
  });

  it('champs du Tertiaire dans l’ordre : embauche, fin, contrat, motif ; motif d’absence seulement pour un remplacement', async () => {
    afficher('planning_tertiaire', 'tertiaire');
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByLabelText(/Date d’embauche \(ou journée de doublon\)/)).toBeTruthy();
    expect(screen.getByLabelText(/^Date de fin/)).toBeTruthy();
    expect(screen.getAllByRole('radio').map((radio) => radio.closest('label').textContent.trim())).toEqual(['CDD', 'CDI']);
    expect(screen.queryByLabelText(/Nom du salarié remplacé/)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'CDD' }));
    expect(screen.getByRole('radio', { name: 'Surcroît d’activité' })).toBeTruthy();
    expect(screen.queryByLabelText(/Motif d.absence/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Remplacement d’un salarié' }));
    expect(screen.getByLabelText(/Nom du salarié remplacé/).maxLength).toBe(100);
    expect(screen.getByLabelText(/Motif d.absence/).maxLength).toBe(100);

    // CDI : plus de date de fin.
    fireEvent.click(screen.getByRole('radio', { name: 'CDI' }));
    expect(screen.queryByLabelText(/^Date de fin/)).toBeNull();
  });

  it('bloc « Salarié et contrat » : qualification juste sous le contrat (et son motif), avant les sites ; plus de bloc « Qualification »', async () => {
    afficher('planning_tertiaire', 'tertiaire');
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy(), { timeout: 4000 });
    expect([...document.querySelectorAll('legend')].some((legende) => legende.textContent === 'Qualification')).toBe(false);
    const bloc = screen.getByText('Salarié et contrat').closest('fieldset');
    const position = (noeud) => [...bloc.querySelectorAll('*')].indexOf(noeud);
    const contrat = bloc.querySelector('input[name="typeContrat"]');
    const categorie = within(bloc).getByLabelText(/^Catégorie/);
    const sites = within(bloc).getByText(/Site\(s\) d.affectation/);
    expect(position(contrat)).toBeLessThan(position(categorie));
    expect(position(categorie)).toBeLessThan(position(sites));
    // Avec un CDD, le motif reste collé au type de contrat, la qualification vient après lui.
    fireEvent.click(screen.getByRole('radio', { name: 'CDD' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Remplacement d’un salarié' }));
    const motifAbsence = within(bloc).getByLabelText(/Motif d.absence/);
    expect(position(contrat)).toBeLessThan(position(motifAbsence));
    expect(position(motifAbsence)).toBeLessThan(position(within(bloc).getByLabelText(/^Catégorie/)));
    // L'échelon n'apparaît qu'une fois la catégorie choisie.
    expect(screen.queryByRole('radio', { name: 'CE1' })).toBeNull();
    fireEvent.change(within(bloc).getByLabelText(/^Catégorie/), { target: { value: 'chef_equipe' } });
    expect(screen.getByRole('radio', { name: 'CE1' })).toBeTruthy();
  });

  it('qualification : l’échelon proposé dépend de la catégorie choisie', async () => {
    afficher('inspecteur', 'tertiaire');
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy(), { timeout: 4000 });
    expect(screen.queryByRole('radio', { name: 'AS1' })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Catégorie/), { target: { value: 'chef_equipe' } });
    expect(['CE1', 'CE2', 'CE3'].every((echelon) => screen.queryByRole('radio', { name: echelon }))).toBe(true);
    expect(screen.queryByRole('radio', { name: 'AS1' })).toBeNull();
  });

  it('rôle de l’Hôtellerie : formulaire de l’Hôtellerie inchangé (postes, échelons, questions propres)', async () => {
    afficher('inspecteur_hotellerie', 'hotellerie');
    await waitFor(() => expect(optionsDe(selectEntite())).toEqual(['Choisir…', 'Hôtellerie', 'Autre']), { timeout: 4000 });
    expect(optionsDe(selectPoste())).toEqual(['Choisir…', 'Femme/Valet de chambre', 'Cafetier', 'Équipier', 'Gouvernant(e)', 'Autre']);
    fireEvent.change(selectPoste(), { target: { value: 'equipier' } });
    expect(screen.getByRole('radio', { name: 'AS' })).toBeTruthy();
    expect(screen.getByText(/A déjà travaillé chez nous/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Catégorie/)).toBeNull();
  });

  it('Admin : choisit l’entité de la demande ; « Tertiaire » bascule sur le formulaire du Tertiaire', async () => {
    afficher('admin', null);
    await waitFor(() => expect(screen.getByText('Entité de la demande')).toBeTruthy(), { timeout: 4000 });
    expect(selectPoste()).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Tertiaire' }));
    await waitFor(() => expect(screen.getByLabelText(/^Catégorie/)).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'Hôtellerie' }));
    await waitFor(() => expect(selectPoste()).toBeTruthy());
  });
});
