import { expect, test } from 'vitest';
import { trouverLieuSimilaire } from './detectionLieuSimilaire';

const LIEUX = [
  { id: 1, adresse: '47 avenue Paul Vaillant Couturier, 94250 Gentilly' },
  { id: 2, adresse: '12 rue de Rivoli, 75004 Paris' },
];

test('retrouve une adresse quasi identique (accents, casse, ponctuation, faute de frappe)', () => {
  expect(trouverLieuSimilaire(LIEUX, '47 Avenue Paul-Vaillant Couturier 94250 Gentily').id).toBe(1);
});

test('ne propose rien pour une adresse différente ou vide', () => {
  expect(trouverLieuSimilaire(LIEUX, '3 place de la République, Lyon')).toBeNull();
  expect(trouverLieuSimilaire(LIEUX, '   ')).toBeNull();
});
