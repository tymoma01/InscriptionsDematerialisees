import { expect, test } from 'vitest';
import { abreviationPoste, libellePoste } from './postes';

test('abréviations hôtellerie, comme dans les événements Outlook des formateurs', () => {
  expect(abreviationPoste('equipier')).toBe('EQP');
  expect(abreviationPoste('cafetier')).toBe('CAF');
  expect(abreviationPoste('gouvernant')).toBe('GOV');
});

test('femme/valet de chambre selon la civilité du candidat', () => {
  expect(abreviationPoste('femme_valet_chambre', 'madame')).toBe('FDC');
  expect(abreviationPoste('femme_valet_chambre', 'monsieur')).toBe('VDC');
  expect(abreviationPoste('femme_valet_chambre', null)).toBe('FDC/VDC');
});

test('abréviations bureau', () => {
  expect(abreviationPoste('nettoyage')).toBe('NETT');
  expect(abreviationPoste('vitrerie')).toBe('VITR');
  expect(abreviationPoste('machiniste')).toBe('MACH');
  expect(abreviationPoste('chef_equipe')).toBe('CEQP');
  expect(abreviationPoste('autres')).toBe('AUTR');
});

test('code inconnu : libellé tel quel', () => {
  expect(abreviationPoste('poste_inconnu')).toBe(libellePoste('poste_inconnu'));
});
