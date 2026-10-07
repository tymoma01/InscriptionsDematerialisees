import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Validation from './Validation';
import { useSession } from '../../core/auth/useSession';
import { listerStatuts, obtenirDossier } from '../../services/dossierService';

vi.mock('../../core/auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dossierService', () => ({ obtenirDossier: vi.fn(), listerStatuts: vi.fn() }));
vi.mock('../../services/pieceJustificativeService', () => ({ listerPiecesJustificatives: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/evaluationService', () => ({ obtenirEvaluationDossier: vi.fn().mockRejectedValue({ response: { status: 404 } }) }));
vi.mock('../../services/transitionService', () => ({ forcerStatut: vi.fn(), marquerEmbauche: vi.fn() }));
// Habillage, notes et blocs annexes : pas l'objet de ces tests.
vi.mock('../../core/backOffice/PageBackOffice', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../core/auth/EnTeteBackOffice', () => ({ default: () => null }));
vi.mock('../../core/dossier/InformationsInscription', () => ({ default: () => null }));
vi.mock('../../core/dossier/NavigationFicheDossier', () => ({ default: () => null }));
vi.mock('../../core/dossier/NotesDossier', () => ({ default: ({ lectureSeule }) => <p>notes du dossier{lectureSeule ? ' (lecture seule)' : ' (ajout possible)'}</p> }));
vi.mock('../../services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: [] }) } }));

const RH = { id: 3, roleCode: 'rh', permissions: ['listeDossiers', 'consultationDossiers', 'forcerStatut', 'lectureNotesDossier', 'ajoutNotesDossier', 'consultationPieces'] };
const RH_SANS_DROITS = { id: 3, roleCode: 'rh', permissions: ['listeDossiers', 'consultationDossiers', 'consultationPieces'] };

function afficher(utilisateur) {
  useSession.mockReturnValue({ utilisateur, chargement: false });
  obtenirDossier.mockResolvedValue({ id: 127, statut_code: 'complet', statut_libelle: 'Complet', candidat_nom: 'Martin', candidat_prenom: 'Sophie' });
  listerStatuts.mockResolvedValue([{ code: 'complet', libelle: 'Complet' }, { code: 'test_non_realise', libelle: 'Test non réalisé' }]);
  render(
    <MemoryRouter initialEntries={['/recruteur/dossiers/127/validation']}>
      <Routes>
        <Route path="/recruteur/dossiers/:dossierId/validation" element={<Validation />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('Fiche dossier candidat : rôle RH', () => {
  it('« Forcer le statut » affiché avec la mention « Réservé aux rôles Admin, Planning et RH », statuts chargés ; notes lisibles et ajout possible', async () => {
    afficher(RH);
    expect(await screen.findByRole('button', { name: 'Forcer le statut' })).toBeTruthy();
    expect(screen.getByText(/Réservé aux rôles Admin, Planning et RH/)).toBeTruthy();
    expect(await screen.findByText('notes du dossier (ajout possible)')).toBeTruthy();
    expect(listerStatuts).toHaveBeenCalled();
  });

  it('sans les permissions du serveur : ni forçage ni notes (l’affichage suit la matrice des droits)', async () => {
    afficher(RH_SANS_DROITS);
    await screen.findByText(/Sophie|Martin|127/);
    expect(screen.queryByRole('button', { name: 'Forcer le statut' })).toBeNull();
    expect(screen.queryByText(/notes du dossier/)).toBeNull();
    expect(listerStatuts).not.toHaveBeenCalled();
  });
});
