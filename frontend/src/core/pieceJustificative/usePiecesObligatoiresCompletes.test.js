import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../services/typesPiecesService', () => ({ listerTypesPieces: vi.fn() }));
vi.mock('../../services/pieceJustificativeService', () => ({ listerPiecesJustificatives: vi.fn() }));

const TYPES = [
  { code: 'carte_identite', obligatoire: true },
  { code: 'rib', obligatoire: true },
  { code: 'autres', obligatoire: false },
];

// Le cache de useTypesPieces vit au niveau du module : chaque test repart d'un module neuf.
let usePiecesObligatoiresCompletes;
let listerTypesPieces;
let listerPiecesJustificatives;
beforeEach(async () => {
  vi.resetModules();
  ({ listerTypesPieces } = await import('../../services/typesPiecesService'));
  ({ listerPiecesJustificatives } = await import('../../services/pieceJustificativeService'));
  ({ usePiecesObligatoiresCompletes } = await import('./usePiecesObligatoiresCompletes'));
});
afterEach(() => vi.clearAllMocks());

test('complet quand toutes les pièces obligatoires de la liste serveur sont chargées', async () => {
  listerTypesPieces.mockResolvedValue(TYPES);
  listerPiecesJustificatives.mockResolvedValue([{ type_piece_code: 'carte_identite' }, { type_piece_code: 'rib' }]);
  const { result } = renderHook(() => usePiecesObligatoiresCompletes(5));
  await waitFor(() => expect(result.current.chargement).toBe(false));
  expect(result.current).toMatchObject({ nombrePiecesObligatoires: 2, piecesObligatoiresCompletes: true, erreur: null });
  expect(listerPiecesJustificatives).toHaveBeenCalledWith(5);
});

test('jamais « complet » si la liste des types n’a pas pu être chargée', async () => {
  listerTypesPieces.mockRejectedValue(new Error('réseau'));
  listerPiecesJustificatives.mockResolvedValue([]);
  const { result } = renderHook(() => usePiecesObligatoiresCompletes(5));
  await waitFor(() => expect(result.current.erreur).toBeTruthy());
  expect(result.current.piecesObligatoiresCompletes).toBe(false);
});

test('inactif : aucune requête de pièces', async () => {
  listerTypesPieces.mockResolvedValue(TYPES);
  const { result } = renderHook(() => usePiecesObligatoiresCompletes(5, { actif: false }));
  await waitFor(() => expect(result.current.chargement).toBe(false));
  expect(listerPiecesJustificatives).not.toHaveBeenCalled();
});
