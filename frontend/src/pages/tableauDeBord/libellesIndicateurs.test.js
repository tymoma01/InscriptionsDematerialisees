import { afterEach, expect, test, vi } from 'vitest';
import {
  bornesParDefaut,
  estIndicateurPoste,
  libelleDateCle,
  libelleIndicateur,
  libellePoste,
  varianteDateCle,
  varianteIndicateur,
} from './libellesIndicateurs';

afterEach(() => vi.useRealTimers());

test('indicateurs simples : libellé fixe, code inconnu affiché tel quel', () => {
  expect(libelleIndicateur('verdict_valide')).toBe('Test réussi');
  expect(libelleIndicateur('indicateur_inconnu')).toBe('indicateur_inconnu');
  expect(varianteIndicateur('indicateur_inconnu')).toBe('neutre');
});

test('indicateurs de poste : libellé du poste, couleur commune', () => {
  expect(libelleIndicateur('poste:gouvernant')).toBe('Gouvernant(e)');
  expect(varianteIndicateur('poste:gouvernant')).toBe('dore');
  expect(estIndicateurPoste('poste:gouvernant')).toBe(true);
  expect(estIndicateurPoste('poste_non_specifie')).toBe(true);
  expect(estIndicateurPoste('verdict_valide')).toBe(false);
  expect(libellePoste(null)).toBe('Non spécifié');
});

test('dates clés : libellés propres, couleur de l’indicateur sinon', () => {
  expect(libelleDateCle('orientation_pret_embauche')).toBe('Orienté-embauche');
  expect(varianteDateCle('test_planifie')).toBe('bleu');
  expect(varianteDateCle('verdict_valide')).toBe(varianteIndicateur('verdict_valide'));
});

test('période par défaut : mois en cours, en date locale (pas de décalage UTC)', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 1, 10, 0, 30));
  expect(bornesParDefaut()).toEqual({ dateDebut: '2026-02-01', dateFin: '2026-02-28' });
  vi.setSystemTime(new Date(2026, 7, 1, 0, 30));
  expect(bornesParDefaut()).toEqual({ dateDebut: '2026-08-01', dateFin: '2026-08-31' });
});
