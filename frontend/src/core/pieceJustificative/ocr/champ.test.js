import { describe, expect, it } from 'vitest';
import { extraireChamp } from './champ';

describe('extraireChamp', () => {
  it('numéro : le mot de 5 à 30 caractères portant un chiffre, ou le texte recollé', () => {
    expect(extraireChamp('numero', 'N° 12AB34567\n')).toBe('12AB34567');
    expect(extraireChamp('numero', '1234 5678 9012')).toBe('123456789012');
    expect(extraireChamp('numero', 'CARTE NATIONALE')).toBeNull();
    expect(extraireChamp('numero', '12')).toBeNull();
  });

  it('dates : une date vraisemblable au format de saisie, sinon null', () => {
    expect(extraireChamp('expire_le', 'valable jusqu’au 26.12.2034')).toBe('2034-12-26');
    expect(extraireChamp('delivree_le', '27 12 2019')).toBe('2019-12-27');
    expect(extraireChamp('delivree_le', '27.12.2099')).toBeNull();
    expect(extraireChamp('expire_le', '31.02.2030')).toBeNull();
    expect(extraireChamp('expire_le', '26.12.2034 27.12.2019')).toBeNull();
    expect(extraireChamp('expire_le', 'rien')).toBeNull();
  });

  it('IBAN : valide uniquement (clé modulo 97), affiché par blocs de 4', () => {
    expect(extraireChamp('iban', 'FR76 3000 6000 0112 3456 7890 189')).toBe('FR76 3000 6000 0112 3456 7890 189');
    expect(extraireChamp('iban', 'FR76 3000 6000 0112 3456 7890 188')).toBeNull();
  });

  it('BIC : le seul mot au format d’un pays SEPA', () => {
    expect(extraireChamp('bic', 'BIC : AGRIFRPP882')).toBe('AGRIFRPP882');
    expect(extraireChamp('bic', 'C E P A F R P P')).toBe('CEPAFRPP');
    expect(extraireChamp('bic', 'DOMICILIATION')).toBeNull();
    expect(extraireChamp('bic', 'AGRIFRPP CEPAFRPP')).toBeNull();
  });

  it('nature inconnue : null', () => {
    expect(extraireChamp('autre', '12345')).toBeNull();
  });
});
