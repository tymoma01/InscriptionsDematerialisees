import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import DetailEvaluation from './DetailEvaluation';
import { useSession } from '../auth/useSession';
import { obtenirDetailEvaluation } from '../../services/evaluationService';
import InformationsInscription from '../dossier/InformationsInscription';

vi.mock('../auth/useSession', () => ({ useSession: vi.fn() }));
vi.mock('../../services/evaluationService', () => ({ obtenirDetailEvaluation: vi.fn() }));
vi.mock('./ContenuDetailEvaluation', () => ({ default: () => <p>contenu du détail</p> }));
vi.mock('../dossier/InformationsInscription', () => ({
  default: vi.fn(({ dossierId }) => <p>Informations d'inscription du dossier {dossierId}</p>),
}));

beforeEach(() => {
  obtenirDetailEvaluation.mockResolvedValue({ evaluation: { id: 5, dossierId: 62 }, questions: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function session(permissions) {
  useSession.mockReturnValue({ utilisateur: { id: 1, roleCode: 'formateur', permissions }, chargement: false, erreur: null });
}

test('le bloc des informations d\'inscription apparaît pour un rôle autorisé (lectureInscription)', async () => {
  session(['lectureInscription']);
  render(<DetailEvaluation evaluationId={5} onFermer={() => {}} />);

  expect(await screen.findByText("Informations d'inscription du dossier 62")).toBeTruthy();
});

test('le bloc n\'apparaît pas sans le droit lectureInscription', async () => {
  session([]);
  render(<DetailEvaluation evaluationId={5} onFermer={() => {}} />);

  await screen.findByText('contenu du détail');
  expect(screen.queryByText(/Informations d'inscription/)).toBeNull();
});

test("le bloc est affiché en lecture seule (aucun bouton Modifier proposé depuis l'historique)", async () => {
  session(['lectureInscription', 'modificationInscription']);
  render(<DetailEvaluation evaluationId={5} onFermer={() => {}} />);

  await screen.findByText("Informations d'inscription du dossier 62");
  expect(InformationsInscription).toHaveBeenCalledWith(expect.objectContaining({ dossierId: 62, lectureSeule: true }), undefined);
});
