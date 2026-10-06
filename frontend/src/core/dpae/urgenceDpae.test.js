// Tests de la pastille d'urgence DPAE (urgenceDpae.js) — lancés par `npm test` (Vitest),
// sans navigateur. Dates construites dans le fuseau du poste, comme le calcul lui-même.
import { expect, test } from 'vitest';
import { calculerUrgence, echeanceDemande, formaterDuree, trierParEcheance } from './urgenceDpae.js';

const HEURE = 60 * 60 * 1000;

// Premier jour tel que l'API le renvoie : minuit local sérialisé en ISO.
const jour = (annee, mois, numero) => new Date(annee, mois - 1, numero).toISOString();
const demande = (surcharges = {}) => ({ statut: 'envoyee', date_debut: jour(2026, 10, 10), heure_arrivee_j1: '08:00:00', ...surcharges });
// Échéance de demande() : 10/10/2026 à 08h00, heure du poste.
const ECHEANCE = new Date(2026, 9, 10, 8, 0);
const avant = (millisecondes) => new Date(ECHEANCE.getTime() - millisecondes);

test('Échéance : premier jour à l’heure d’arrivée du jour 1, sinon à 00h00 ; aucune sans premier jour', () => {
  expect(echeanceDemande(demande()).getTime()).toBe(ECHEANCE.getTime());
  expect(echeanceDemande(demande({ heure_arrivee_j1: null })).getTime()).toBe(new Date(2026, 9, 10, 0, 0).getTime());
  expect(echeanceDemande(demande({ date_debut: null }))).toBe(null);
});

test('Seuil 72 h : plus de 72 h -> vert ; exactement 72 h -> orange', () => {
  expect(calculerUrgence(demande(), avant(72 * HEURE + 1)).niveau).toBe('vert');
  expect(calculerUrgence(demande(), avant(72 * HEURE + 1)).variante).toBe('urgence-vert');
  expect(calculerUrgence(demande(), avant(72 * HEURE)).niveau).toBe('orange');
  expect(calculerUrgence(demande(), avant(72 * HEURE)).variante).toBe('urgence-orange');
});

test('Seuil 48 h : exactement 48 h -> orange ; juste en dessous -> rouge', () => {
  expect(calculerUrgence(demande(), avant(48 * HEURE)).niveau).toBe('orange');
  expect(calculerUrgence(demande(), avant(48 * HEURE - 1)).niveau).toBe('rouge');
  expect(calculerUrgence(demande(), avant(48 * HEURE - 1)).variante).toBe('urgence-rouge');
});

test('Seuil 0 h : échéance atteinte à l’instant -> rouge (pas encore en retard) ; dépassée d’une milliseconde -> « En retard »', () => {
  const pile = calculerUrgence(demande(), avant(0));
  expect(pile.niveau).toBe('rouge');
  expect(pile.libelle).toBe('Jour J');
  const depassee = calculerUrgence(demande(), avant(-1));
  expect([depassee.niveau, depassee.variante, depassee.libelle]).toStrictEqual(['retard', 'urgence-rouge', 'En retard']);
});

test('Premier jour largement dépassé -> « En retard », info-bulle avec le retard exact', () => {
  const urgence = calculerUrgence(demande(), avant(-(26 * HEURE + 30 * 60 * 1000)));
  expect(urgence.libelle).toBe('En retard');
  expect(urgence.infoBulle).toBe('En retard de 1 j 2 h 30 min : premier jour le 10/10/2026 à 08h00');
});

test('Texte court en jours calendaires (« J-5 », « J-2 », « Jour J ») et délai exact en info-bulle', () => {
  const j5 = calculerUrgence(demande(), new Date(2026, 9, 5, 14, 15));
  expect([j5.libelle, j5.niveau]).toStrictEqual(['J-5', 'vert']);
  expect(j5.infoBulle).toBe('Premier jour dans 4 j 17 h 45 min : le 10/10/2026 à 08h00');
  expect(calculerUrgence(demande(), new Date(2026, 9, 8, 9, 0)).libelle).toBe('J-2');
  expect(calculerUrgence(demande(), new Date(2026, 9, 10, 7, 0)).libelle).toBe('Jour J');
  expect(calculerUrgence(demande({ heure_arrivee_j1: null }), new Date(2026, 9, 5)).infoBulle).toMatch(/à 00h00 \(heure d'arrivée non renseignée\)$/);
});

test('Pastille pour les quatre statuts non décidés (dont « À valider par le Planning » et « Renvoyée à l’inspecteur ») ; aucune pour Validée, Rejetée ou sans premier jour', () => {
  const maintenant = avant(10 * HEURE);
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    expect(calculerUrgence(demande({ statut }), maintenant), statut).toBeTruthy();
  }
  expect(calculerUrgence(demande({ statut: 'validee' }), maintenant)).toBe(null);
  expect(calculerUrgence(demande({ statut: 'rejetee' }), maintenant)).toBe(null);
  expect(calculerUrgence(demande({ date_debut: null }), maintenant)).toBe(null);
});

test('Durée : jours, heures, minutes ; parties nulles omises', () => {
  expect(formaterDuree(72 * HEURE)).toBe('3 j');
  expect(formaterDuree(90 * 60 * 1000)).toBe('1 h 30 min');
  expect(formaterDuree(30 * 1000)).toBe("moins d'une minute");
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
  expect(trierParEcheance(demandes).map((d) => d.id)).toStrictEqual([3, 5, 4, 1, 6, 2]);
  expect(demandes.map((d) => d.id), 'tableau reçu non modifié').toStrictEqual([1, 2, 3, 4, 5, 6]);
});
