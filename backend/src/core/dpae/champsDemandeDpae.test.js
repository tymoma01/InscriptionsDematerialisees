const test = require('node:test');
const assert = require('node:assert/strict');

const { CHAMPS, colonnesDepuisDonnees, champsModifies } = require('./champsDemandeDpae');

// Demande telle que la lit le repository (formes du pilote pg : date en Date locale, time en
// 'HH:MM:SS', decimal en chaîne, jsonb déjà décodé) et la demande saisie équivalente (formes du
// formulaire).
const EN_BASE = {
  type_demande: 'nouvelle_embauche',
  salarie_nom: 'Martin',
  salarie_prenom: 'Sophie',
  salarie_telephone: null,
  salarie_deja_employe: false,
  candidat_id: null,
  hotel: 'Ancien texte',
  type_contrat: 'cdd',
  motif_cdd: 'surcroit_activite',
  salarie_remplace_nom: null,
  date_fin_absence: null,
  raison_surcroit: 'Séminaire',
  division: null,
  division_autre: null,
  poste: 'equipier',
  poste_autre: null,
  date_debut: new Date(2026, 9, 12),
  date_fin: new Date(2026, 9, 30),
  heure_arrivee_j1: '07:30:00',
  heures_par_mois: '151.67',
  modifications_demandees: false,
  modification_horaires: false,
  modification_jours_repos: false,
  modification_affectation: false,
  nouvelle_affectation: null,
  type_changement_jours: null,
  jours_concernes: [],
  raison_changement_jours: null,
  raison_identique_contrat: null,
  semaine_type: [{ jour: 'lundi', statut: 'travail', heureDebut: '07:00', heureFin: '15:00' }],
  horaires_differents_par_jour: false,
  autre_chose_signaler: null,
  verif_besoin_hotel: true,
  verif_tous_jours_inclus: true,
  verif_non_planification: true,
};

const SAISIE = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Sophie',
  salarieTelephone: '',
  salarieDejaEmploye: false,
  typeContrat: 'cdd',
  motifCdd: 'surcroit_activite',
  raisonSurcroit: 'Séminaire',
  poste: 'equipier',
  dateDebut: '2026-10-12',
  dateFin: '2026-10-30',
  heureArriveeJ1: '07:30',
  heuresParMois: 151.67,
  joursConcernes: [],
  // Clés dans un autre ordre que celui renvoyé par jsonb : sans effet sur la comparaison.
  semaineType: [{ heureFin: '15:00', statut: 'travail', jour: 'lundi', heureDebut: '07:00' }],
  verifBesoinHotel: true,
  verifTousJoursInclus: true,
  verifNonPlanification: true,
};

test('champsModifies : une saisie identique à la demande en base ne signale aucun champ (formes différentes, même valeur)', () => {
  assert.deepEqual(champsModifies(EN_BASE, SAISIE), []);
});

test('champsModifies : renvoie les NOMS des champs modifiés, jamais leurs valeurs', () => {
  const champs = champsModifies(EN_BASE, {
    ...SAISIE,
    salarieNom: 'Durand',
    salarieTelephone: '0612345678',
    dateDebut: '2026-10-13',
    heuresParMois: 100,
    semaineType: [{ jour: 'lundi', statut: 'repos', heureDebut: '', heureFin: '' }],
    verifBesoinHotel: false,
  });
  assert.deepEqual(champs.sort(), ['dateDebut', 'heuresParMois', 'salarieNom', 'salarieTelephone', 'semaineType', 'verifBesoinHotel']);
  const texte = JSON.stringify(champs);
  for (const valeur of ['Durand', '0612345678', '2026-10-13']) assert.equal(texte.includes(valeur), false);
});

test('champsModifies : le texte libre `hotel` non envoyé n’est ni écrit ni signalé (jamais effacé)', () => {
  assert.equal('hotel' in colonnesDepuisDonnees(SAISIE), false);
  assert.equal(champsModifies(EN_BASE, SAISIE).includes('hotel'), false);
  assert.equal('hotel' in colonnesDepuisDonnees({ ...SAISIE, hotel: 'Nouveau' }), true);
  assert.equal(champsModifies(EN_BASE, { ...SAISIE, hotel: 'Nouveau' }).includes('hotel'), true);
});

test('colonnesDepuisDonnees : ne contient jamais le demandeur, l’entité, la date de création, le statut ni la version', () => {
  const colonnes = Object.keys(colonnesDepuisDonnees({ ...SAISIE, demandeurId: 99, entiteId: 2, statut: 'validee', version: 9, dateCreation: 'x' }));
  for (const interdite of ['demandeur_id', 'entite_id', 'date_creation', 'statut', 'version', 'id']) {
    assert.equal(colonnes.includes(interdite), false, interdite);
  }
  assert.equal(CHAMPS.length, new Set(CHAMPS.map((champ) => champ.colonne)).size);
});

test('colonnesDepuisDonnees : mêmes conversions qu’à la création (vide -> null, listes JSON sérialisées)', () => {
  const colonnes = colonnesDepuisDonnees(SAISIE);
  assert.equal(colonnes.salarie_telephone, null);
  assert.equal(colonnes.candidat_id, null);
  assert.equal(colonnes.heures_par_mois, 151.67);
  assert.equal(colonnes.jours_concernes, '[]');
  assert.equal(typeof colonnes.semaine_type, 'string');
});
