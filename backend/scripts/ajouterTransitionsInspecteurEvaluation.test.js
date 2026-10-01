// Droits de transition du rôle Inspecteur (audit 2026-10-01, bug de production : « NSPP » refusé à
// l'Inspecteur, « Rôle "inspecteur" non autorisé pour l'action "test_non_realise" »).
// Usage : node --test scripts/ajouterTransitionsInspecteurEvaluation.test.js (hors du glob de
// npm test, comme scripts/reparerRendezvousEvaluesRemplaces.test.js). Aucune base requise.

const test = require('node:test');
const assert = require('node:assert/strict');

const { CODES_ACTION_EVALUATION, calculerAjouts } = require('./ajouterTransitionsInspecteurEvaluation');
const { ROLES_PAR_ACTION_ACCECIT } = require('./seedTransitionRoles');
const { ROLES } = require('../src/core/auth/rbac');

const TRANSITIONS_FORMATION = ['valider_envoi_formation', 'marquer_formation_validee', 'invalider_formation'];

// Transitions de l'entité telles que les lit le script (même forme que sa requête).
const TRANSITIONS = [
  { id: 14, code_action: 'test_non_realise' },
  { id: 33, code_action: 'confirmer_test_realise' },
  { id: 35, code_action: 'valider_pret_embauche' },
  { id: 36, code_action: 'invalider_test' },
  { id: 34, code_action: 'valider_envoi_formation' },
  { id: 40, code_action: 'marquer_formation_validee' },
];

test('Script : ajoute seulement les transitions d’évaluation manquantes (cas réel DEV/PROD : test_non_realise seule)', () => {
  const ajouts = calculerAjouts(TRANSITIONS, [33, 35, 36]);
  assert.deepEqual(ajouts.map((t) => t.code_action), ['test_non_realise']);
});

test('Script : relancé une fois tout ajouté, il n’ajoute plus rien (idempotence)', () => {
  const premierPassage = calculerAjouts(TRANSITIONS, [33, 35, 36]).map((t) => t.id);
  assert.deepEqual(calculerAjouts(TRANSITIONS, [33, 35, 36, ...premierPassage]), []);
});

test('Script : n’ajoute JAMAIS une transition de formation à l’Inspecteur, même absente de ses droits', () => {
  const ajouts = calculerAjouts(TRANSITIONS, []).map((t) => t.code_action);
  for (const code of TRANSITIONS_FORMATION) assert.equal(ajouts.includes(code), false, code);
  for (const code of TRANSITIONS_FORMATION) assert.equal(CODES_ACTION_EVALUATION.includes(code), false, code);
});

test('Seed : l’Inspecteur a TOUT le parcours d’évaluation, NSPP (test_non_realise) compris', () => {
  for (const code of CODES_ACTION_EVALUATION) {
    assert.ok(ROLES_PAR_ACTION_ACCECIT[code]?.includes(ROLES.INSPECTEUR), `${code} doit autoriser l'Inspecteur`);
  }
});

test('Seed : aucune transition de formation pour l’Inspecteur (aucun dossier Tertiaire en formation)', () => {
  for (const code of TRANSITIONS_FORMATION) {
    assert.equal(ROLES_PAR_ACTION_ACCECIT[code]?.includes(ROLES.INSPECTEUR), false, code);
  }
});

test('Seed : chaque rôle déclaré existe (aucun rôle supprimé référencé, ex. l’ancien Recruteur)', () => {
  const rolesExistants = Object.values(ROLES);
  for (const [code, roles] of Object.entries(ROLES_PAR_ACTION_ACCECIT)) {
    for (const role of roles) assert.ok(rolesExistants.includes(role), `${code} : rôle « ${role} » inconnu`);
  }
  assert.equal('valider_dossier' in ROLES_PAR_ACTION_ACCECIT, false);
  assert.equal('rejeter_dossier' in ROLES_PAR_ACTION_ACCECIT, false);
});
