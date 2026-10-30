import { describe, expect, it } from 'vitest';
import { analyserRib } from './rib';

// RIB fictif : IBAN d'exemple de la norme, valide.
const RIB = `RELEVE D'IDENTITE BANCAIRE
Titulaire du compte : M. PAUL MARTIN
Domiciliation : AGENCE PARIS OPERA
Code banque  Code guichet  N° de compte  Clé RIB
30006        00001         12345678901   89
IBAN (International Bank Account Number)
FR76 3000 6000 0112 3456 7890 189
BIC (Bank Identifier Code) : AGRIFRPP882
`;

describe('analyserRib', () => {
  it('lit l’IBAN par blocs de 4 et le BIC qui suit sa mention', () => {
    expect(analyserRib(RIB)).toEqual({ iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' });
  });

  it('corrige une clé lue comme des lettres, que le modulo 97 confirme', () => {
    // Exemple de la norme, clé 14 lue « I4 » ; compte contenant une lettre.
    expect(analyserRib('IBAN : FRI4 2004 1010 0505 0001 3M02 606').iban).toBe('FR1420041010050500013M02606');
  });

  it('corrige la clé RIB finale lue comme des lettres (« Y02 » lu « Yo2 »)', () => {
    // Texte reconnu sur une photo de RIB La Banque Postale ; le compte se termine par une lettre.
    const texte = 'IBAN - Identifiant international de compte\nFR20 1001 1000 2075 6196 7989 Yo2 k [';
    expect(analyserRib(texte).iban).toBe('FR2010011000207561967989Y02');
  });

  it('ne corrige jamais le numéro de compte, qui peut contenir des lettres', () => {
    // « Y » du compte laissé tel quel, le « O » du code guichet corrigé.
    expect(analyserRib('FR20 1001 1OOO 2075 6196 7989 Y02').iban).toBe('FR2010011000207561967989Y02');
    expect(analyserRib('FR20 1001 1000 2075 6196 7989 YO2').iban).toBe('FR2010011000207561967989Y02');
  });

  it('recolle un BIC écrit lettre par lettre, comme dans le texte de certains PDF', () => {
    const pdf = `BIC (Identifiant international de l'établissement)
Relevé d'identité
30006   00001   12345678901   89
FR76 3000 6000 0112 3456 7890 189
A   G   R   I   F   R   P   P   8   8   2
`;
    expect(analyserRib(pdf)).toEqual({ iban: 'FR7630006000011234567890189', bic: 'AGRIFRPP882' });
  });

  it('retrouve un BIC sans mention, s’il est le seul du pays de l’IBAN', () => {
    expect(analyserRib(RIB.replace('BIC (Bank Identifier Code) : ', 'Code : ')).bic).toBe('AGRIFRPP882');
  });

  it('ne renvoie rien qui ne se contrôle pas : IBAN faux, BIC d’un autre pays', () => {
    expect(analyserRib(RIB.replace('7890 189', '7890 188'))).toEqual({ iban: null, bic: null });
    expect(analyserRib(RIB.replace('AGRIFRPP882', 'DEUTDEFF')).bic).toBeNull();
  });
});
