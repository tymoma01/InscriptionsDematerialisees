import { expect, test } from 'vitest';
import { calculerPiecesObligatoiresCompletes, construirePiecesCapturees } from './premierePlanificationTest';

const TYPES = [
  { code: 'carte_identite', obligatoire: true },
  { code: 'rib', obligatoire: true },
  { code: 'autres', obligatoire: false },
];

test('construirePiecesCapturees garde la première pièce de chaque type', () => {
  const pieces = construirePiecesCapturees([
    { id: 1, type_piece_code: 'rib' },
    { id: 2, type_piece_code: 'rib' },
    { id: 3, type_piece_code: 'autres' },
  ]);
  expect([...pieces.keys()]).toEqual(['rib', 'autres']);
  expect(pieces.get('rib').id).toBe(1);
});

test('complet seulement quand toutes les pièces obligatoires sont présentes', () => {
  const incomplet = construirePiecesCapturees([{ type_piece_code: 'rib' }, { type_piece_code: 'autres' }]);
  expect(calculerPiecesObligatoiresCompletes(incomplet, TYPES)).toEqual({
    nombrePiecesObligatoires: 2,
    piecesObligatoiresCompletes: false,
  });
  const complet = construirePiecesCapturees([{ type_piece_code: 'rib' }, { type_piece_code: 'carte_identite' }]);
  expect(calculerPiecesObligatoiresCompletes(complet, TYPES).piecesObligatoiresCompletes).toBe(true);
});
