const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const rendezvousRepository = require('./rendezvousRepository');

// `bd` : instance knex RÉELLE mais JAMAIS connectée — `client: 'pg'` suffit à générer du SQL
// valide et à le récupérer via `.toString()`, sans dépendre d'une connexion Neon réelle. Même
// principe que dossierRepository.test.js/statistiquesRepository.test.js.
const bd = knex({ client: 'pg' });

// Délai de grâce de 24h avant bascule automatique "Test non réalisé" (audit 2026-09-09) — la
// requête doit comparer la FIN du créneau (date_heure + dureeCreneauMinutes), pas date_heure seule,
// à (maintenant - delaiGraceHeures). Vérifié sur le SQL généré plutôt qu'en exécutant contre une
// vraie base : cette requête n'a pas de dépendance métier testable autrement qu'en lisant le SQL
// (make_interval), même patron que dossierRepository.test.js.
test('listerRendezvousTestNonRealisesAutomatiquement compare la FIN du créneau (date_heure + durée) à (now() - délai de grâce), pas date_heure seule', () => {
  const sql = rendezvousRepository
    .listerRendezvousTestNonRealisesAutomatiquement(bd, 1, { dureeCreneauMinutes: 30, delaiGraceHeures: 24 })
    .toString();

  assert.match(
    sql,
    /rendezvous\.date_heure \+ make_interval\(mins => 30\) < now\(\) - make_interval\(hours => 24\)/,
  );
  // Régression : ne doit plus jamais comparer `date_heure` seule à `now()` (comportement d'avant
  // ce correctif, bascule dès le créneau passé sans aucun délai de grâce).
  assert.doesNotMatch(sql, /"rendezvous"\."date_heure" < now\(\)/);
});

test("listerRendezvousTestNonRealisesAutomatiquement exclut tout rendez-vous dont la présence a été confirmée (bouton Présent(e), date_presence_confirmee non NULL)", () => {
  const sql = rendezvousRepository
    .listerRendezvousTestNonRealisesAutomatiquement(bd, 1, { dureeCreneauMinutes: 30, delaiGraceHeures: 24 })
    .toString();

  assert.match(sql, /"rendezvous"\."date_presence_confirmee" is null/i);
});

// marquerPresenceConfirmee n'est pas testable en génération de SQL comme ci-dessus : sa dernière
// étape (.then(([rendezvous]) => rendezvous), même patron que mettreAJourStatutRendezvous) en fait
// une vraie Promise dès son retour, pas un query builder dont .toString() reflète le SQL — cette
// fonction est couverte par un test bout-en-bout (vérification manuelle documentée dans le rapport
// de la tâche, pas de connexion DB disponible dans cette suite unitaire).
