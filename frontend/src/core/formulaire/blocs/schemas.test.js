import { describe, expect, test } from 'vitest';
import { blocCoordonneesSchema } from './BlocCoordonnees.schema';
import { blocInfosPersoSchema, NIR_REGEX } from './BlocInfosPerso.schema';
import { NATIONALITES } from './nationalites';

const INFOS_VALIDES = {
  civilite: 'madame',
  nom: 'Martin',
  nomNaissance: '',
  lieuNaissance: 'Lyon',
  nationalite: NATIONALITES[0],
  prenom: 'Élodie',
  dateNaissance: '1990-01-01',
  nir: '',
  situationFamiliale: 'celibataire',
};

const COORDONNEES_VALIDES = {
  adresse: '12 rue de Rivoli',
  codePostal: '75004',
  ville: 'Paris',
  telephone: '06 12 34 56 78',
  email: 'elodie@exemple.fr',
  contactUrgenceNom: "Jean-Pierre d'Arc",
  contactUrgenceTelephone: '0712345678',
};

describe('bloc informations personnelles', () => {
  test('NIR : facultatif, sinon 15 chiffres (espace toléré avant la clé)', () => {
    expect(NIR_REGEX.test('190017512345678')).toBe(true);
    expect(NIR_REGEX.test('1900175123456 78')).toBe(true);
    expect(NIR_REGEX.test('19001751234567')).toBe(false);
    expect(blocInfosPersoSchema.safeParse(INFOS_VALIDES).success).toBe(true);
    expect(blocInfosPersoSchema.safeParse({ ...INFOS_VALIDES, nir: '123' }).success).toBe(false);
  });

  test('nom de naissance : lettres uniquement quand il est renseigné', () => {
    expect(blocInfosPersoSchema.safeParse({ ...INFOS_VALIDES, nomNaissance: 'Le Gall-Dupré' }).success).toBe(true);
    expect(blocInfosPersoSchema.safeParse({ ...INFOS_VALIDES, nomNaissance: 'Martin2' }).success).toBe(false);
  });

  test('nationalité : uniquement une valeur de la liste', () => {
    expect(blocInfosPersoSchema.safeParse({ ...INFOS_VALIDES, nationalite: 'Atlante' }).success).toBe(false);
  });
});

describe('bloc coordonnées', () => {
  test('accepte des coordonnées françaises valides', () => {
    expect(blocCoordonneesSchema.safeParse(COORDONNEES_VALIDES).success).toBe(true);
  });

  test.each([
    ['codePostal', '7500'],
    ['telephone', '+33612345678'],
    ['telephone', '0012345678'],
    ['email', 'pas-un-email'],
    ['ville', 'Paris 4'],
    ['contactUrgenceTelephone', '06123'],
  ])('refuse %s = %s', (champ, valeur) => {
    expect(blocCoordonneesSchema.safeParse({ ...COORDONNEES_VALIDES, [champ]: valeur }).success).toBe(false);
  });
});
