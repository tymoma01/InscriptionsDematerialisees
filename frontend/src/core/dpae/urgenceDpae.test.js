// Tests de la pastille d'urgence DPAE (urgenceDpae.js) — lancés par `npm test` (node --test), sans
// navigateur. Dates construites dans le fuseau du poste, comme le calcul lui-même.
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculerUrgence, echeanceDemande, formaterDuree, trierParEcheance } from './urgenceDpae.js';

const HEURE = 60 * 60 * 1000;

// Premier jour tel que l'API le renvoie : minuit local sérialisé en ISO.
const jour = (annee, mois, numero) => new Date(annee, mois - 1, numero).toISOString();
const demande = (surcharges = {}) => ({ statut: 'envoyee', date_debut: jour(2026, 10, 10), heure_arrivee_j1: '08:00:00', ...surcharges });
// Échéance de demande() : 10/10/2026 à 08h00, heure du poste.
const ECHEANCE = new Date(2026, 9, 10, 8, 0);
const avant = (millisecondes) => new Date(ECHEANCE.getTime() - millisecondes);

test('Échéance : premier jour à l’heure d’arrivée du jour 1, sinon à 00h00 ; aucune sans premier jour', () => {
  assert.equal(echeanceDemande(demande()).getTime(), ECHEANCE.getTime());
  assert.equal(echeanceDemande(demande({ heure_arrivee_j1: null })).getTime(), new Date(2026, 9, 10, 0, 0).getTime());
  assert.equal(echeanceDemande(demande({ date_debut: null })), null);
});

test('Seuil 72 h : plus de 72 h -> vert ; exactement 72 h -> orange', () => {
  assert.equal(calculerUrgence(demande(), avant(72 * HEURE + 1)).niveau, 'vert');
  assert.equal(calculerUrgence(demande(), avant(72 * HEURE + 1)).variante, 'urgence-vert');
  assert.equal(calculerUrgence(demande(), avant(72 * HEURE)).niveau, 'orange');
  assert.equal(calculerUrgence(demande(), avant(72 * HEURE)).variante, 'urgence-orange');
});

test('Seuil 48 h : exactement 48 h -> orange ; juste en dessous -> rouge', () => {
  assert.equal(calculerUrgence(demande(), avant(48 * HEURE)).niveau, 'orange');
  assert.equal(calculerUrgence(demande(), avant(48 * HEURE - 1)).niveau, 'rouge');
  assert.equal(calculerUrgence(demande(), avant(48 * HEURE - 1)).variante, 'urgence-rouge');
});

test('Seuil 0 h : échéance atteinte à l’instant -> rouge (pas encore en retard) ; dépassée d’une milliseconde -> « En retard »', () => {
  const pile = calculerUrgence(demande(), avant(0));
  assert.equal(pile.niveau, 'rouge');
  assert.equal(pile.libelle, 'Jour J');
  const depassee = calculerUrgence(demande(), avant(-1));
  assert.deepEqual([depassee.niveau, depassee.variante, depassee.libelle], ['retard', 'urgence-rouge', 'En retard']);
});

test('Premier jour largement dépassé -> « En retard », info-bulle avec le retard exact', () => {
  const urgence = calculerUrgence(demande(), avant(-(26 * HEURE + 30 * 60 * 1000)));
  assert.equal(urgence.libelle, 'En retard');
  assert.equal(urgence.infoBulle, 'En retard de 1 j 2 h 30 min : premier jour le 10/10/2026 à 08h00');
});

test('Texte court en jours calendaires (« J-5 », « J-2 », « Jour J ») et délai exact en info-bulle', () => {
  const j5 = calculerUrgence(demande(), new Date(2026, 9, 5, 14, 15));
  assert.deepEqual([j5.libelle, j5.niveau], ['J-5', 'vert']);
  assert.equal(j5.infoBulle, 'Premier jour dans 4 j 17 h 45 min : le 10/10/2026 à 08h00');
  assert.equal(calculerUrgence(demande(), new Date(2026, 9, 8, 9, 0)).libelle, 'J-2');
  assert.equal(calculerUrgence(demande(), new Date(2026, 9, 10, 7, 0)).libelle, 'Jour J');
  assert.match(calculerUrgence(demande({ heure_arrivee_j1: null }), new Date(2026, 9, 5)).infoBulle, /à 00h00 \(heure d'arrivée non renseignée\)$/);
});

test('Pastille seulement pour « À traiter » et « En attente » ; aucune pour Validée, Rejetée ou sans premier jour', () => {
  const maintenant = avant(10 * HEURE);
  assert.ok(calculerUrgence(demande({ statut: 'envoyee' }), maintenant));
  assert.ok(calculerUrgence(demande({ statut: 'en_attente' }), maintenant));
  assert.equal(calculerUrgence(demande({ statut: 'validee' }), maintenant), null);
  assert.equal(calculerUrgence(demande({ statut: 'rejetee' }), maintenant), null);
  assert.equal(calculerUrgence(demande({ date_debut: null }), maintenant), null);
});

test('Durée : jours, heures, minutes ; parties nulles omises', () => {
  assert.equal(formaterDuree(72 * HEURE), '3 j');
  assert.equal(formaterDuree(90 * 60 * 1000), '1 h 30 min');
  assert.equal(formaterDuree(30 * 1000), "moins d'une minute");
});

test('Tri par échéance : la plus proche d’abord, en retard tout en haut, sans premier jour en fin, ordre reçu conservé à égalité', () => {
  const demandes = [
    { id: 1, date_debut: jour(2026, 10, 20) },
    { id: 2, date_debut: null },
    { id: 3, date_debut: jour(2026, 9, 1) }, // en retard
    { id: 4, date_debut: jour(2026, 10, 10), heure_arrivee_j1: '14:00:00' },
    { id: 5, date_debut: jour(2026, 10, 10), heure_arrivee_j1: '08:00:00' },
    { id: 6, date_debut: jour(2026, 10, 20) },
  ];
  assert.deepEqual(trierParEcheance(demandes).map((d) => d.id), [3, 5, 4, 1, 6, 2]);
  assert.deepEqual(demandes.map((d) => d.id), [1, 2, 3, 4, 5, 6], 'tableau reçu non modifié');
});
