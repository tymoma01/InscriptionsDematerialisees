import { expect, test } from 'vitest';
import { varianteCreneau } from './creneaux';

test('chaque créneau a sa variante, associée à son code', () => {
  expect(['6h-9h', '9h-18h', '18h-21h'].map(varianteCreneau)).toEqual(['bleu', 'dore', 'violet']);
  expect(['matin', 'midi', 'soir'].map(varianteCreneau)).toEqual(['jaune-pale', 'vert-eau', 'lavande']);
});

test('un créneau inconnu garde le style neutre, sans erreur', () => {
  expect(varianteCreneau('nuit')).toBe('neutre');
  expect(varianteCreneau(undefined)).toBe('neutre');
});
