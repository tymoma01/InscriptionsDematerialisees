import { describe, expect, test } from 'vitest';
import { filtrerDossiers } from './filtrerDossiers';

function dossier(valeurs) {
  return {
    id: 1,
    candidat_prenom: 'Jean',
    candidat_nom: 'Dupont',
    candidat_email: 'jean.dupont@exemple.fr',
    candidat_telephone: '06 12 34 56 78',
    candidat_code_postal: '94250',
    statut_code: 'test_planifie',
    statut_libelle: 'Test planifié',
    date_maj: '2026-09-15T10:00:00Z',
    postesHotel: ['femme_chambre'],
    postesBureau: [],
    ...valeurs,
  };
}

const SANS_FILTRE = { recherche: '' };

describe('filtrerDossiers — recherche', () => {
  const dossiers = [
    dossier({ id: 12 }),
    dossier({ id: 34, candidat_prenom: 'Élodie', candidat_nom: 'Martin', candidat_email: 'e.martin@exemple.fr', candidat_telephone: '0700000000' }),
  ];

  test('un nombre court cherche le numéro de dossier exact', () => {
    expect(filtrerDossiers(dossiers, { recherche: '34' }).map((d) => d.id)).toEqual([34]);
    expect(filtrerDossiers(dossiers, { recherche: '3' })).toEqual([]);
  });

  test('un nombre de 10 chiffres cherche le téléphone, espaces et tirets ignorés', () => {
    expect(filtrerDossiers(dossiers, { recherche: '06-12-34-56-78' }).map((d) => d.id)).toEqual([12]);
  });

  test('le nom se cherche mot par mot, sans accents, dans n’importe quel ordre', () => {
    expect(filtrerDossiers(dossiers, { recherche: 'martin elodie' }).map((d) => d.id)).toEqual([34]);
  });

  test('l’email et le libellé de statut sont aussi cherchés', () => {
    expect(filtrerDossiers(dossiers, { recherche: 'e.martin@' }).map((d) => d.id)).toEqual([34]);
    expect(filtrerDossiers(dossiers, { recherche: 'test planifie' })).toHaveLength(2);
  });

  test('le libellé de poste passe par libellePoste quand il est fourni', () => {
    const libellePoste = (code) => (code === 'femme_chambre' ? 'Femme de chambre' : code);
    expect(filtrerDossiers(dossiers, { recherche: 'femme de chambre', libellePoste })).toHaveLength(2);
  });
});

describe('filtrerDossiers — filtres', () => {
  test('code postal : correspondance sur le début', () => {
    const dossiers = [dossier({ id: 1 }), dossier({ id: 2, candidat_code_postal: '75011' })];
    expect(filtrerDossiers(dossiers, { ...SANS_FILTRE, codePostalFiltre: '94' }).map((d) => d.id)).toEqual([1]);
  });

  test('dates : bornes incluses sur la journée entière', () => {
    const dossiers = [dossier({ id: 1, date_maj: '2026-09-15T23:00:00' }), dossier({ id: 2, date_maj: '2026-09-16T08:00:00' })];
    const resultat = filtrerDossiers(dossiers, { ...SANS_FILTRE, dateDebutFiltre: '2026-09-15', dateFinFiltre: '2026-09-15' });
    expect(resultat.map((d) => d.id)).toEqual([1]);
  });

  test('secteur : hôtel, bureau ou les deux', () => {
    const dossiers = [dossier({ id: 1 }), dossier({ id: 2, postesHotel: [], postesBureau: ['nettoyage'] })];
    expect(filtrerDossiers(dossiers, { ...SANS_FILTRE, entitesFiltre: new Set(['bureau']) }).map((d) => d.id)).toEqual([2]);
    expect(filtrerDossiers(dossiers, { ...SANS_FILTRE, entitesFiltre: new Set(['hotel', 'bureau']) })).toHaveLength(2);
    expect(filtrerDossiers(dossiers, { ...SANS_FILTRE, entitesFiltre: new Set() })).toHaveLength(2);
  });

  test('un dossier « nouveau » sans aucun poste (inscription inachevée) est masqué', () => {
    const dossiers = [dossier({ id: 1, statut_code: 'nouveau', postesHotel: [] }), dossier({ id: 2, statut_code: 'nouveau' })];
    expect(filtrerDossiers(dossiers, SANS_FILTRE).map((d) => d.id)).toEqual([2]);
  });
});
