const test = require('node:test');
const assert = require('node:assert/strict');

const statutsDpae = require('./statutsDpae');
const { PERMISSIONS } = require('../auth/permissions');

test('statuts : quatre statuts dans l’ordre du cycle de vie, statut initial « À traiter » (code envoyee)', () => {
  assert.deepEqual(statutsDpae.CODES_STATUTS_DPAE, ['envoyee', 'en_attente', 'validee', 'rejetee']);
  assert.equal(statutsDpae.STATUT_INITIAL, 'envoyee');
  assert.equal(statutsDpae.STATUTS_DPAE[0].libelle, 'À traiter');
});

test('statuts « à décider » déduits de la table des transitions : À traiter et En attente', () => {
  assert.deepEqual([...statutsDpae.STATUTS_A_DECIDER], ['envoyee', 'en_attente']);
});

test('table des transitions : exactement les sept transitions autorisées', () => {
  const transitions = statutsDpae.TRANSITIONS.map(({ action, de, vers }) => `${action}:${de}->${vers}`).sort();
  assert.deepEqual(transitions, [
    'mettre_en_attente:envoyee->en_attente',
    'modifier:en_attente->envoyee',
    'modifier:envoyee->envoyee',
    'rejeter:en_attente->rejetee',
    'rejeter:envoyee->rejetee',
    'valider:en_attente->validee',
    'valider:envoyee->validee',
  ]);
});

test('transition non autorisée : aucune depuis un statut final, ni mise en attente depuis En attente', () => {
  for (const action of [statutsDpae.ACTION_VALIDER, statutsDpae.ACTION_REJETER, statutsDpae.ACTION_METTRE_EN_ATTENTE, statutsDpae.ACTION_MODIFIER]) {
    assert.equal(statutsDpae.trouverTransition(action, 'validee'), undefined, action);
    assert.equal(statutsDpae.trouverTransition(action, 'rejetee'), undefined, action);
  }
  assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_METTRE_EN_ATTENTE, 'en_attente'), undefined);
  assert.equal(statutsDpae.trouverTransition('inconnue', 'envoyee'), undefined);
});

test('chaque transition ne relie que des statuts connus et exige une permission qui existe dans la matrice des droits', () => {
  for (const transition of statutsDpae.TRANSITIONS) {
    assert.ok(statutsDpae.CODES_STATUTS_DPAE.includes(transition.de), transition.de);
    assert.ok(statutsDpae.CODES_STATUTS_DPAE.includes(transition.vers), transition.vers);
    assert.ok(transition.permission in PERMISSIONS, transition.permission);
  }
});

test('modification : « À traiter » reste « À traiter », « En attente » repasse « À traiter »', () => {
  assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_MODIFIER, 'envoyee').vers, 'envoyee');
  assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_MODIFIER, 'en_attente').vers, 'envoyee');
});

test('permissionPourAction : permission unique par action, exception pour une action inconnue', () => {
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_VALIDER), 'dpaeTraitementRh');
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_MODIFIER), 'dpaeModification');
  assert.throws(() => statutsDpae.permissionPourAction('inconnue'), /permission absente ou ambiguë/);
});

test('listeSql : codes entre apostrophes, séparés par des virgules', () => {
  assert.equal(statutsDpae.listeSql(statutsDpae.STATUTS_A_DECIDER), "'envoyee', 'en_attente'");
});
