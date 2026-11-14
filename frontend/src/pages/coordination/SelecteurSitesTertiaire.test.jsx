import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import SelecteurSitesAffectation from './SelecteurSitesAffectation';
import * as service from '../../services/siteAffectationService';

vi.mock('../../services/siteAffectationService', () => ({
  listerSitesAffectation: vi.fn(),
  creerSiteAffectation: vi.fn(),
  creerSiteTertiaire: vi.fn(),
  renommerSiteTertiaire: vi.fn(),
}));

function Hote({ secteur, peutRenommer = false }) {
  const [selection, setSelection] = useState([]);
  return (
    <>
      <SelecteurSitesAffectation secteur={secteur} peutRenommer={peutRenommer} selection={selection} onChangerSelection={setSelection} ouvert onChangerOuvert={() => {}} />
      <p data-testid="selection">{selection.join(',')}</p>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Sites d’affectation du Tertiaire (formulaire)', () => {
  it('liste les sites du Tertiaire (chargés pour ce secteur), recherche par nom, sans initiales', async () => {
    service.listerSitesAffectation.mockResolvedValue([
      { id: 1, nom: 'Tour Horizon', initiales: null },
      { id: 2, nom: 'Gare Nord', initiales: null },
    ]);
    render(<Hote secteur="tertiaire" />);
    await screen.findByText('Tour Horizon');
    expect(service.listerSitesAffectation).toHaveBeenCalledWith({ secteur: 'tertiaire' });
    fireEvent.change(screen.getByLabelText("Rechercher un site d'affectation"), { target: { value: 'gare' } });
    expect(screen.queryByText('Tour Horizon')).toBeNull();
    expect(screen.getByText('Gare Nord')).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Ajouter un site' })).toBeTruthy();
  });

  it('« + Ajouter un site » : nom (100 caractères) et adresse facultative ; le site créé est sélectionné immédiatement', async () => {
    service.listerSitesAffectation.mockResolvedValue([]);
    service.creerSiteTertiaire.mockResolvedValue({ id: 9, nom: 'Nouveau site', initiales: null, adresse: '3 rue Y' });
    render(<Hote secteur="tertiaire" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Ajouter un site' }));
    const fenetre = screen.getByRole('dialog');
    const nom = within(fenetre).getByLabelText(/Nom du site/);
    expect(nom.maxLength).toBe(100);
    expect(within(fenetre).getByRole('button', { name: 'Enregistrer' }).disabled).toBe(true);
    fireEvent.change(nom, { target: { value: 'Nouveau site' } });
    fireEvent.change(within(fenetre).getByLabelText(/Adresse/), { target: { value: '3 rue Y' } });
    fireEvent.click(within(fenetre).getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe('9'));
    expect(service.creerSiteTertiaire).toHaveBeenCalledWith({ nom: 'Nouveau site', adresse: '3 rue Y', confirmerProche: false, secteur: 'tertiaire' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getAllByText('Nouveau site').length).toBeGreaterThan(0);
  });

  it('nom très proche d’un site existant : signalé avant création, avec le choix du site existant', async () => {
    service.listerSitesAffectation.mockResolvedValue([{ id: 1, nom: 'Tour Horizon', initiales: null }]);
    service.creerSiteTertiaire.mockRejectedValue({
      response: { status: 409, data: { erreur: 'Un site au nom très proche existe déjà : « Tour Horizon ».', sitesProches: [{ id: 1, nom: 'Tour Horizon' }], identique: true } },
    });
    render(<Hote secteur="tertiaire" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Ajouter un site' }));
    fireEvent.change(screen.getByLabelText(/Nom du site/), { target: { value: 'tour  horizon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/Un site au nom très proche existe déjà/)).toBeTruthy();
    // Identique : pas de « Créer quand même ».
    expect(screen.queryByRole('button', { name: 'Créer quand même' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choisir ce site' }));
    expect(screen.getByTestId('selection').textContent).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nom seulement proche : « Créer quand même » confirme la création', async () => {
    service.listerSitesAffectation.mockResolvedValue([]);
    service.creerSiteTertiaire
      .mockRejectedValueOnce({ response: { status: 409, data: { erreur: 'Un site au nom proche existe déjà : « Tour Horizon ».', sitesProches: [{ id: 1, nom: 'Tour Horizon' }], identique: false } } })
      .mockResolvedValueOnce({ id: 10, nom: 'Tour Horizo', initiales: null, adresse: null });
    render(<Hote secteur="tertiaire" />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Ajouter un site' }));
    fireEvent.change(screen.getByLabelText(/Nom du site/), { target: { value: 'Tour Horizo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Créer quand même' }));
    await waitFor(() => expect(service.creerSiteTertiaire).toHaveBeenLastCalledWith({ nom: 'Tour Horizo', adresse: '', confirmerProche: true, secteur: 'tertiaire' }));
    await waitFor(() => expect(screen.getByTestId('selection').textContent).toBe('10'));
  });

  it('Hôtellerie inchangée : liste historique, recherche nom ou initiales, ajout avec initiales', async () => {
    service.listerSitesAffectation.mockResolvedValue([{ id: 1, nom: 'AIGLON', initiales: 'AIG' }]);
    render(<Hote />);
    await screen.findByText('AIGLON');
    expect(service.listerSitesAffectation).toHaveBeenCalledWith({ secteur: undefined });
    expect(screen.getByPlaceholderText('Rechercher un site (nom ou initiales)')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Ajouter un site'));
    expect(screen.getByLabelText('Initiales')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Renommage d’un site du Tertiaire dans la liste', () => {
  const SITES = [
    { id: 1, nom: 'Tour Horizon', initiales: null },
    { id: 2, nom: 'Gare Nord', initiales: null },
  ];
  const crayon = (nom) => screen.queryByRole('button', { name: `Modifier le nom du site ${nom}` });

  it('profil habilité : un crayon à côté de chaque site ; Entrée valide, le nom est mis à jour dans la liste', async () => {
    service.listerSitesAffectation.mockResolvedValue(SITES);
    service.renommerSiteTertiaire.mockResolvedValue({ id: 1, nom: 'Tour Horizon Nord' });
    render(<Hote secteur="tertiaire" peutRenommer />);
    await screen.findByText('Tour Horizon');
    expect(crayon('Tour Horizon')).toBeTruthy();
    expect(crayon('Gare Nord')).toBeTruthy();
    fireEvent.click(crayon('Tour Horizon'));
    const champ = screen.getByLabelText('Nouveau nom du site Tour Horizon');
    expect(champ.value).toBe('Tour Horizon');
    fireEvent.change(champ, { target: { value: 'Tour Horizon Nord' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    await waitFor(() => expect(service.renommerSiteTertiaire).toHaveBeenCalledWith(1, 'Tour Horizon Nord'));
    await screen.findByText('Tour Horizon Nord');
    expect(screen.queryByLabelText(/Nouveau nom du site/)).toBeNull();
  });

  it('✓ valide aussi ; Échap annule sans appel au serveur', async () => {
    service.listerSitesAffectation.mockResolvedValue(SITES);
    service.renommerSiteTertiaire.mockResolvedValue({});
    render(<Hote secteur="tertiaire" peutRenommer />);
    await screen.findByText('Gare Nord');
    fireEvent.click(crayon('Gare Nord'));
    fireEvent.keyDown(screen.getByLabelText('Nouveau nom du site Gare Nord'), { key: 'Escape' });
    expect(screen.queryByLabelText(/Nouveau nom du site/)).toBeNull();
    expect(service.renommerSiteTertiaire).not.toHaveBeenCalled();
    fireEvent.click(crayon('Gare Nord'));
    fireEvent.change(screen.getByLabelText('Nouveau nom du site Gare Nord'), { target: { value: 'Gare du Nord' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider le nouveau nom' }));
    await waitFor(() => expect(service.renommerSiteTertiaire).toHaveBeenCalledWith(2, 'Gare du Nord'));
  });

  it('nom en doublon ou très proche : le message du serveur est affiché, le champ reste ouvert', async () => {
    service.listerSitesAffectation.mockResolvedValue(SITES);
    service.renommerSiteTertiaire.mockRejectedValue({ response: { status: 409, data: { erreur: 'Un site nommé « Gare Nord » existe déjà : ce nom ne peut pas être utilisé.' } } });
    render(<Hote secteur="tertiaire" peutRenommer />);
    await screen.findByText('Tour Horizon');
    fireEvent.click(crayon('Tour Horizon'));
    const champ = screen.getByLabelText('Nouveau nom du site Tour Horizon');
    fireEvent.change(champ, { target: { value: 'gare  nord' } });
    fireEvent.keyDown(champ, { key: 'Enter' });
    expect(await screen.findByText(/existe déjà : ce nom ne peut pas être utilisé/)).toBeTruthy();
    expect(screen.getByLabelText('Nouveau nom du site Tour Horizon')).toBeTruthy();
  });

  it('autres profils (Formateur Tertiaire) : pas de crayon, mais l’ajout d’un site reste possible', async () => {
    service.listerSitesAffectation.mockResolvedValue(SITES);
    render(<Hote secteur="tertiaire" peutRenommer={false} />);
    await screen.findByText('Tour Horizon');
    expect(crayon('Tour Horizon')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Ajouter un site' })).toBeTruthy();
  });

  it('Hôtellerie : aucune icône crayon, même pour un profil habilité', async () => {
    service.listerSitesAffectation.mockResolvedValue([{ id: 1, nom: 'AIGLON', initiales: 'AIG' }]);
    render(<Hote peutRenommer />);
    await screen.findByText('AIGLON');
    expect(crayon('AIGLON')).toBeNull();
    expect(screen.queryByTitle('Modifier le nom')).toBeNull();
  });
});
