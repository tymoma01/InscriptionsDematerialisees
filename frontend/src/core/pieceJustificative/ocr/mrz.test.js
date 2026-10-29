import { describe, expect, it } from 'vitest';
import { analyserMrz, cle, ecarts } from './mrz';

// Spécimens officiels : nouvelle et ancienne carte d'identité (ministère de l'Intérieur), passeport
// d'exemple de la norme OACI 9303.
const CNI = ['IDFRAX4RTBPFW46<<<<<<<<<<<<<<<', '9007138F3002119FRA<<<<<<<<<<<6', 'MARTIN<<MAELYS<GAELLE<MARIE<<<'].join('\n');
const CNI_ANCIENNE = ['IDFRABERTHIER<<<<<<<<<<<<<<<<<<<<<<<', '8806923102858CORINNE<<<<<<<6512068F6'].join('\n');
const PASSEPORT = ['P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<', 'L898902C36UTO7408122F1204159ZE184226B<<<<<10'].join('\n');

describe('analyserMrz', () => {
  it('calcule la clé de contrôle OACI', () => {
    expect(cle('L898902C3')).toBe('6');
    expect(cle('740812')).toBe('2');
  });

  it('lit la nouvelle carte d’identité : numéro, naissance, expiration, noms', () => {
    expect(analyserMrz(CNI)).toEqual({
      type: 'carte_identite',
      numero: 'X4RTBPFW4',
      naissance: '1990-07-13',
      expire_le: '2030-02-11',
      nom: 'MARTIN',
      prenoms: 'MAELYS GAELLE MARIE',
    });
  });

  it('lit l’ancienne carte d’identité, sans date d’expiration', () => {
    expect(analyserMrz(CNI_ANCIENNE)).toEqual({
      type: 'carte_identite',
      numero: '880692310285',
      naissance: '1965-12-06',
      expire_le: null,
      nom: 'BERTHIER',
      prenoms: 'CORINNE',
    });
  });

  it('lit le passeport', () => {
    expect(analyserMrz(PASSEPORT)).toMatchObject({ type: 'passeport', numero: 'L898902C3', expire_le: '2012-04-15', nom: 'ERIKSSON' });
  });

  it('retrouve la bande dans un texte bruité : autres lignes, espaces, lettre lue pour un chiffre, « < » perdu', () => {
    const bruite = [
      'REPUBLIQUE FRANCAISE',
      'IDFRA X4RTBPFW46<<<<<<<<<<<<<<',
      '9OO7138F3002119FRA<<<<<<<<<<<6',
      'MARTIN<<MAELYS<GAELLE<MARIE<<<',
      '',
    ].join('\n');
    expect(analyserMrz(bruite)).toMatchObject({ numero: 'X4RTBPFW4', naissance: '1990-07-13' });
  });

  it('ne renvoie rien si une clé ne concorde pas : pas de valeur devinée', () => {
    expect(analyserMrz(CNI.replace('X4RTBPFW4', 'X4RTBPFW5'))).toBeNull();
    expect(analyserMrz('aucune bande lisible')).toBeNull();
  });
});

describe('ecarts', () => {
  const mrz = analyserMrz(CNI);

  it('accepte le nom (accents, tirets, nom de naissance) et la date de naissance du formulaire', () => {
    expect(ecarts(mrz, { nom: 'Martin', date_naissance: '1990-07-13' })).toEqual([]);
    expect(ecarts(mrz, { nom: 'Durand', nom_naissance: 'Martin', date_naissance: '1990-07-13' })).toEqual([]);
  });

  it('signale un nom ou une date de naissance différents', () => {
    expect(ecarts(mrz, { nom: 'Dupont', nom_naissance: '', date_naissance: '1991-07-13' })).toEqual(['nom', 'date_naissance']);
  });
});
