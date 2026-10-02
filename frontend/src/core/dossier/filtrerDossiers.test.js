import { describe, expect, test } from 'vitest';
import { FILTRE_ETUDIANT, basculerChoixUnique, compterEtudiants, correspondFiltreEtudiant, filtrerDossiers } from './filtrerDossiers';

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

// Filtre « Étudiant » (2026-10-02, remplace la colonne « Étudiant » ; pas de filtre « Non étudiant »).
describe('filtrerDossiers — filtre Étudiant', () => {
  const LISTE = [
    dossier({ id: 1, est_etudiant: true, postesHotel: ['cafetier'], postesBureau: [], statut_code: 'test_planifie' }),
    dossier({ id: 2, est_etudiant: true, postesHotel: [], postesBureau: ['nettoyage'], statut_code: 'nouveau' }),
    dossier({ id: 3, est_etudiant: false, postesHotel: ['equipier'], postesBureau: [], statut_code: 'test_planifie' }),
    dossier({ id: 4, est_etudiant: false, postesHotel: ['gouvernant'], postesBureau: [], statut_code: 'nouveau' }),
    dossier({ id: 5, est_etudiant: null, postesHotel: ['cafetier'], postesBureau: [], statut_code: 'test_planifie' }),
    dossier({ id: 6, est_etudiant: true, postesHotel: ['equipier'], postesBureau: [], statut_code: 'nouveau' }),
  ];
  const BASE = { recherche: '', entitesFiltre: new Set() };
  const ids = (liste) => liste.map((d) => d.id);

  test('compteur Étudiant ; filtre : étudiants seulement (non étudiants et sans réponse exclus)', () => {
    expect(compterEtudiants(LISTE)).toBe(3);
    expect(ids(filtrerDossiers(LISTE, { ...BASE, etudiantFiltre: FILTRE_ETUDIANT }))).toEqual([1, 2, 6]);
    expect(ids(filtrerDossiers(LISTE, { ...BASE, etudiantFiltre: '' }))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('combinaison avec le secteur et un statut (liste et compteurs)', () => {
    const avecStatut = (liste, statut) => liste.filter((d) => d.statut_code === statut);
    // Hôtellerie + Étudiant + « Test planifié » : seul le dossier 1.
    const hotelEtudiants = filtrerDossiers(LISTE, { ...BASE, entitesFiltre: new Set(['hotel']), etudiantFiltre: FILTRE_ETUDIANT });
    expect(ids(avecStatut(hotelEtudiants, 'test_planifie'))).toEqual([1]);
    // Compteur Étudiant avec Hôtellerie et « Test planifié » sélectionnés (base : tout sauf le filtre
    // Étudiant lui-même) : 1 (dossier 1) ; 3 non étudiant et 5 sans réponse exclus.
    const baseCompteur = avecStatut(filtrerDossiers(LISTE, { ...BASE, entitesFiltre: new Set(['hotel']) }), 'test_planifie');
    expect(compterEtudiants(baseCompteur)).toBe(1);
    // Compteur Hôtellerie quand « Étudiant » est sélectionné : 1 et 6.
    const hotelEtudiantsTousStatuts = filtrerDossiers(LISTE, { ...BASE, etudiantFiltre: FILTRE_ETUDIANT }).filter((d) => d.postesHotel.length > 0);
    expect(ids(hotelEtudiantsTousStatuts)).toEqual([1, 6]);
  });

  test('désélection : un second clic revient à la liste complète ; valeur inconnue sans effet', () => {
    expect(basculerChoixUnique('', FILTRE_ETUDIANT)).toBe(FILTRE_ETUDIANT);
    expect(basculerChoixUnique(FILTRE_ETUDIANT, FILTRE_ETUDIANT)).toBe('');
    expect(correspondFiltreEtudiant({ est_etudiant: false }, 'non_etudiant')).toBe(true);
    expect(correspondFiltreEtudiant({ est_etudiant: null }, '')).toBe(true);
  });
});
