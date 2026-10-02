import { describe, expect, test } from 'vitest';
import { destinationDuRole, peut } from './permissions';

describe('peut', () => {
  test('vrai seulement si la clé figure dans les permissions reçues avec la session', () => {
    const utilisateur = { roleCode: 'rh', permissions: ['dpaeConsultation', 'cloche'] };
    expect(peut(utilisateur, 'cloche')).toBe(true);
    expect(peut(utilisateur, 'forcerStatut')).toBe(false);
  });

  test('faux sans utilisateur ou sans liste de permissions (ancienne session)', () => {
    expect(peut(null, 'cloche')).toBe(false);
    expect(peut({ roleCode: 'admin' }, 'cloche')).toBe(false);
  });
});

describe('destinationDuRole', () => {
  test('écran propre à chaque rôle, tableau de bord Accueil sinon', () => {
    expect(destinationDuRole('formateur')).toBe('/formateur/evaluations');
    expect(destinationDuRole('inspecteur')).toBe('/inspecteur/evaluations');
    expect(destinationDuRole('rh')).toBe('/rh/dpae');
    expect(destinationDuRole('inspecteur_hotellerie')).toBe('/tableau-de-bord/indicateurs');
    expect(destinationDuRole('admin')).toBe('/accueil/tableau-de-bord');
    expect(destinationDuRole('planning')).toBe('/accueil/tableau-de-bord');
  });
});
