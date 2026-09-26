// Couvre uniquement determinerStatutTraitement (fonction pure, aucun accès base) — les 4
// conditions du point 2 de la demande, dans leur ordre de vérification, plus les deux cas de sortie
// hors "ignoré simple" (INTROUVABLE, DEJA_TRAITE). Hors du glob "src/**/*.test.js" de `npm test`
// (ce fichier vit dans scripts/, pas src/) : à lancer explicitement avec
// `node --test scripts/reparerRendezvousEvaluesRemplaces.test.js` depuis backend/.
const test = require('node:test');
const assert = require('node:assert/strict');

const { determinerStatutTraitement } = require('./reparerRendezvousEvaluesRemplaces');

test('rendez-vous introuvable -> INTROUVABLE', () => {
  const decision = determinerStatutTraitement({ rendezvous: null, aEvaluation: false, aRendezvousTestPlusRecent: false });
  assert.equal(decision.code, 'INTROUVABLE');
});

test("rendez-vous déjà à 'honore' -> DEJA_TRAITE (idempotence)", () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'honore', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'DEJA_TRAITE');
});

test("statut différent de 'remplace' (et de 'honore') -> IGNORE, raison explicite", () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'prevu', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /statut actuel « prevu »/);
});

test("statut 'remplace' mais type_rdv différent de 'test' -> IGNORE", () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'entretien' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /type_rdv « entretien »/);
});

test('statut/type corrects mais aucune évaluation liée -> IGNORE', () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'test' },
    aEvaluation: false,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /aucune évaluation liée/);
});

test('statut/type/évaluation corrects mais un rendez-vous test plus récent existe -> IGNORE', () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: true,
  });
  assert.equal(decision.code, 'IGNORE');
  assert.match(decision.raison, /rendez-vous test plus récent/);
});

test('les 4 conditions réunies -> ELIGIBLE', () => {
  const decision = determinerStatutTraitement({
    rendezvous: { statut: 'remplace', type_rdv: 'test' },
    aEvaluation: true,
    aRendezvousTestPlusRecent: false,
  });
  assert.equal(decision.code, 'ELIGIBLE');
});
