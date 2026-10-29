import { describe, expect, it } from 'vitest';
import { analyserVerso } from './verso';

const AUJOURDHUI = '2026-10-20';
const lire = (texte) => analyserVerso(texte, AUJOURDHUI);

// Lectures réelles d'un verso (modèle fra, encre noire isolée), dates et adresse changées.
describe('analyserVerso', () => {
  it('lit les deux dates après leurs libellés, quels que soient les séparateurs', () => {
    const attendu = { expire_le: '2033-03-14', delivree_le: '2018-03-15' };
    expect(
      lire(`Adresse : 12 HUE DE LA PAIK
75002 PAPIS .
Carte valable jusqu'au: | 14.03.2033 ; ;
délivrée le: 15.03.2018 j D à
per: PRÉPECINRE DE POLIOE (75-15 = À`),
    ).toEqual(attendu);
    expect(lire('Carte valable jusque : 14 03 2033\ndélivrée le : 15 03 2018')).toEqual(attendu);
    expect(lire("Carte valable jusqu'au: 14.03. 2033\ndélivrée le: 15.03.2018 ;")).toEqual(attendu);
  });

  it('prend la date de la ligne suivante quand l’OCR sépare libellé et valeur', () => {
    expect(lire("Carte valable jusqu'au :\n\n14.03.2033\n\ndélivrée le :\n15.03.2018")).toEqual({
      expire_le: '2033-03-14',
      delivree_le: '2018-03-15',
    });
  });

  it('libellés illisibles : la plus ancienne des deux dates est la délivrance', () => {
    expect(lire('Crte vlbl jsq : 14.03.2033\ndlvre : 15.03.2018')).toEqual({ expire_le: '2033-03-14', delivree_le: '2018-03-15' });
  });

  it('garde une date seule', () => {
    expect(lire("Carte valable jusqu'au : 14.03.2033\nd... : ??")).toEqual({ expire_le: '2033-03-14', delivree_le: null });
  });

  it('écarte une date impossible ou invraisemblable', () => {
    expect(lire("valable jusqu'au : 31.02.2033\ndélivrée le : 15.03.2018")).toEqual({ expire_le: null, delivree_le: '2018-03-15' });
    expect(lire('délivrée le : 15.03.2027')).toBeNull();
    // Validité négative ou de plus de 20 ans : l'une des deux est mal lue, on ne sait pas laquelle.
    expect(lire("valable jusqu'au : 14.03.2013\ndélivrée le : 15.03.2018")).toBeNull();
    expect(lire("valable jusqu'au : 14.03.2093\ndélivrée le : 15.03.2018")).toBeNull();
  });

  it('ne trouve rien dans du bruit', () => {
    expect(lire('ee ES rm ee a DS a res Se = =\n72m =4 1e')).toBeNull();
  });
});
