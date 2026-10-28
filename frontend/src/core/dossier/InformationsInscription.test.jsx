import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import InformationsInscription from './InformationsInscription';
import { useSession } from '../auth/useSession';
import { obtenirInscriptionComplete } from '../../services/dossierService';
import { listerPiecesJustificatives } from '../../services/pieceJustificativeService';

vi.mock('../auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/dossierService', () => ({ obtenirInscriptionComplete: vi.fn(), modifierInscription: vi.fn() }));
vi.mock('../../services/pieceJustificativeService', () => ({ listerPiecesJustificatives: vi.fn(), obtenirApercuPiece: vi.fn() }));
vi.mock('../pieceJustificative/useTypesPieces', () => ({ useTypesPieces: () => ({ typesPieces: [] }) }));
vi.mock('./useRafraichissementAuto', () => ({ useRafraichissementAuto: vi.fn() }));

beforeEach(() => {
  useSession.mockReturnValue({
    utilisateur: { id: 1, roleCode: 'admin', permissions: ['lectureInscription', 'modificationInscription'] },
    chargement: false,
    erreur: null,
  });
  obtenirInscriptionComplete.mockResolvedValue({
    candidat: { nom: 'Martin', prenom: 'Sophie', civilite: 'madame' },
    blocs: {},
  });
  listerPiecesJustificatives.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function ouvrir(props) {
  const { container } = render(<InformationsInscription dossierId={62} {...props} />);
  fireEvent.click(screen.getByText("Voir les informations d'inscription complètes"));
  // Le <details> est ouvert par le clic sur le <summary> ; l'événement toggle charge l'inscription.
  const details = container.querySelector('details');
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await screen.findByText(/Martin/);
}

test('« Modifier » est proposé à un rôle autorisé sur la fiche dossier', async () => {
  await ouvrir({});
  expect(screen.getByRole('button', { name: 'Modifier' })).toBeTruthy();
});

test('lectureSeule masque « Modifier », même pour un rôle autorisé', async () => {
  await ouvrir({ lectureSeule: true });
  expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
});
