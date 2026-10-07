import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import DemandeDpae from './DemandeDpae';
import { useSession } from '../../core/auth/useSession';
import { listerNotesDemande, modifierDemande, obtenirDemande } from '../../services/dpaeService';

vi.mock('../../core/auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dpaeService', () => ({ creerDemande: vi.fn(), modifierDemande: vi.fn(), obtenirDemande: vi.fn(), listerNotesDemande: vi.fn() }));
vi.mock('../../services/siteAffectationService', () => ({
  listerSitesAffectation: vi.fn().mockResolvedValue([{ id: 10, nom: 'AIGLON', initiales: 'AIG', actif: true }]),
  creerSiteAffectation: vi.fn(),
}));
// L'habillage back-office n'est pas l'objet de ces tests.
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));

// Demande telle que la renvoie GET /api/dpae/:id : complète, donc le formulaire est directement valide.
function demandeEnBase(statut, surcharges = {}) {
  return {
    id: 7,
    version: 4,
    statut,
    type_demande: 'nouvelle_embauche',
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
    salarie_deja_employe: false,
    type_contrat: 'cdi',
    poste: 'equipier',
    date_debut: '2026-10-12',
    sites_affectation: [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }],
    semaine_type: [],
    verif_besoin_hotel: true,
    verif_tous_jours_inclus: true,
    verif_non_planification: true,
    ...surcharges,
  };
}

function afficher(demande) {
  obtenirDemande.mockResolvedValue(demande);
  render(
    <MemoryRouter initialEntries={['/coordination/dpae/7/modifier']}>
      <Routes>
        <Route path="/coordination/dpae/:demandeId/modifier" element={<DemandeDpae />} />
        <Route path="/rh/dpae/:id" element={<p>fiche de la demande</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useSession.mockReturnValue({ utilisateur: { roleCode: 'inspecteur_hotellerie', permissions: ['dpaeModification'] }, chargement: false });
  modifierDemande.mockResolvedValue({ statut: 'a_valider_planning', version: 5 });
  listerNotesDemande.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const champNote = () => screen.findByLabelText(/Note sur la modification/);
const boutonEnregistrer = () => screen.getByRole('button', { name: 'Enregistrer les modifications' });

describe('Formulaire de modification : note sur la modification', () => {
  it('« Renvoyée à l’inspecteur » : note obligatoire, 3 dernières notes (texte, auteur, date) en lecture seule au-dessus du champ', async () => {
    const notes = [4, 3, 2, 1].map((n) => ({
      id: n,
      contenu: `Note numéro ${n}`,
      auteur_prenom: 'Léa',
      auteur_nom: `Roux${n}`,
      date_creation: '2026-10-06T10:30:00.000Z',
    }));
    listerNotesDemande.mockResolvedValue(notes);
    afficher(demandeEnBase('renvoyee_inspecteur'));
    const note = await champNote();
    expect(note.required).toBe(true);
    expect(note.maxLength).toBe(1000);
    expect(await screen.findByText('Note numéro 4')).toBeTruthy();
    expect(screen.getByText('Note numéro 2')).toBeTruthy();
    expect(screen.queryByText('Note numéro 1')).toBeNull();
    expect(screen.getByText(/Léa Roux4/)).toBeTruthy();
    expect(screen.queryByText(/motif/i)).toBeNull();
    expect(boutonEnregistrer().disabled).toBe(true);

    fireEvent.change(note, { target: { value: '   ' } });
    expect(boutonEnregistrer().disabled).toBe(true);
    fireEvent.change(note, { target: { value: 'Horaires du samedi : 8h-14h' } });
    expect(boutonEnregistrer().disabled).toBe(false);

    fireEvent.click(boutonEnregistrer());
    await waitFor(() => expect(modifierDemande).toHaveBeenCalledTimes(1));
    expect(modifierDemande.mock.calls[0][1]).toMatchObject({ version: 4, noteModification: 'Horaires du samedi : 8h-14h' });
    await screen.findByText('fiche de la demande');
  });

  it('« En attente » : note obligatoire, dernières notes affichées', async () => {
    listerNotesDemande.mockResolvedValue([{ id: 1, contenu: 'Pièce manquante', auteur_prenom: 'Leo', auteur_nom: 'Weiss', date_creation: '2026-10-06T10:30:00.000Z' }]);
    afficher(demandeEnBase('en_attente'));
    const note = await champNote();
    expect(note.required).toBe(true);
    expect(await screen.findByText('Pièce manquante')).toBeTruthy();
    expect(boutonEnregistrer().disabled).toBe(true);
  });

  it('autres statuts : note facultative, aucun motif affiché, note absente du corps si vide', async () => {
    afficher(demandeEnBase('a_valider_planning'));
    const note = await champNote();
    expect(note.required).toBe(false);
    expect(screen.queryByText(/Dernières notes/)).toBeNull();
    expect(listerNotesDemande).not.toHaveBeenCalled();
    expect(boutonEnregistrer().disabled).toBe(false);

    fireEvent.click(boutonEnregistrer());
    await waitFor(() => expect(modifierDemande).toHaveBeenCalledTimes(1));
    expect(modifierDemande.mock.calls[0][1].noteModification).toBeUndefined();
  });

  it('note seule (version inchangée) : retour à la fiche avec la confirmation « La note a été enregistrée. »', async () => {
    modifierDemande.mockResolvedValue({ statut: 'envoyee', version: 4, noteEnregistree: true });
    afficher(demandeEnBase('envoyee'));
    fireEvent.change(await champNote(), { target: { value: 'Précision' } });
    fireEvent.click(boutonEnregistrer());
    await screen.findByText('fiche de la demande');
  });
});
