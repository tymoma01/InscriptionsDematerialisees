const test = require('node:test');
const assert = require('node:assert/strict');

const statutsDpae = require('./statutsDpae');
const { PERMISSIONS } = require('../auth/permissions');

test('statuts : sept statuts dans l’ordre du cycle de vie, statut initial « À traiter » (code envoyee)', () => {
  assert.deepEqual(statutsDpae.CODES_STATUTS_DPAE, ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee', 'classee_sans_suite']);
  assert.equal(statutsDpae.STATUT_INITIAL, 'envoyee');
  assert.deepEqual(
    statutsDpae.STATUTS_DPAE.map(({ libelle }) => libelle),
    ['À valider par le Planning', 'Renvoyée à l\'inspecteur', 'À traiter', 'En attente', 'Validée', 'Rejetée', 'Classée sans suite'],
  );
});

test('statuts « à décider » déduits de la table des transitions : les deux statuts du Planning, À traiter et En attente', () => {
  assert.deepEqual([...statutsDpae.STATUTS_A_DECIDER], ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']);
});

test('statuts à traiter par la RH : À traiter et En attente seulement ; statuts d’avant la RH : les deux statuts du Planning', () => {
  assert.deepEqual([...statutsDpae.STATUTS_A_TRAITER_RH], ['envoyee', 'en_attente']);
  assert.deepEqual([...statutsDpae.STATUTS_AVANT_RH], ['a_valider_planning', 'renvoyee_inspecteur']);
});

test('table des transitions : exactement les vingt et une transitions autorisées', () => {
  const transitions = statutsDpae.TRANSITIONS.map(({ action, de, vers }) => `${action}:${de}->${vers}`).sort();
  assert.deepEqual(transitions, [
    'classer_sans_suite:a_valider_planning->classee_sans_suite',
    'classer_sans_suite:en_attente->classee_sans_suite',
    'classer_sans_suite:envoyee->classee_sans_suite',
    'classer_sans_suite:renvoyee_inspecteur->classee_sans_suite',
    'envoyer_au_planning:renvoyee_inspecteur->a_valider_planning',
    'mettre_en_attente:envoyee->en_attente',
    'modifier:a_valider_planning->a_valider_planning',
    'modifier:en_attente->en_attente',
    'modifier:envoyee->envoyee',
    'modifier:renvoyee_inspecteur->renvoyee_inspecteur',
    'reactiver:classee_sans_suite->a_valider_planning',
    'reactiver:classee_sans_suite->en_attente',
    'reactiver:classee_sans_suite->envoyee',
    'reactiver:classee_sans_suite->renvoyee_inspecteur',
    'rejeter:en_attente->rejetee',
    'rejeter:envoyee->rejetee',
    'renvoyer_inspecteur:a_valider_planning->renvoyee_inspecteur',
    'retransmettre_rh:en_attente->envoyee',
    'transmettre_rh:a_valider_planning->envoyee',
    'valider:en_attente->validee',
    'valider:envoyee->validee',
  ]);
});

test('passage par le Planning : transmettre et renvoyer depuis « À valider » seulement, par la permission Planning/Admin ; aucun rejet ni décision RH depuis les statuts d’avant la RH', () => {
  for (const action of [statutsDpae.ACTION_TRANSMETTRE_RH, statutsDpae.ACTION_RENVOYER_INSPECTEUR]) {
    assert.equal(statutsDpae.permissionPourAction(action), 'dpaeValidationPlanning');
    assert.ok(statutsDpae.trouverTransition(action, 'a_valider_planning'));
    for (const statut of ['renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee']) {
      assert.equal(statutsDpae.trouverTransition(action, statut), undefined, `${action} depuis ${statut}`);
    }
  }
  for (const statut of statutsDpae.STATUTS_AVANT_RH) {
    for (const action of [statutsDpae.ACTION_VALIDER, statutsDpae.ACTION_REJETER, statutsDpae.ACTION_METTRE_EN_ATTENTE]) {
      assert.equal(statutsDpae.trouverTransition(action, statut), undefined, `${action} depuis ${statut}`);
    }
  }
  assert.deepEqual(PERMISSIONS.dpaeValidationPlanning, ['planning', 'admin']);
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

test('modification : le statut ne change jamais (chaque statut modifiable reste le même)', () => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_MODIFIER, statut).vers, statut, statut);
  }
  assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_MODIFIER, 'validee'), undefined);
});

test('envoi au Planning : seulement depuis « Renvoyée à l’inspecteur », vers « À valider par le Planning »', () => {
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_ENVOYER_AU_PLANNING), 'dpaeEnvoiPlanning');
  assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_ENVOYER_AU_PLANNING, 'renvoyee_inspecteur').vers, 'a_valider_planning');
  for (const statut of ['a_valider_planning', 'envoyee', 'en_attente', 'validee', 'rejetee', 'classee_sans_suite']) {
    assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_ENVOYER_AU_PLANNING, statut), undefined, statut);
  }
});

test('permissionPourAction : permission unique par action, exception pour une action inconnue', () => {
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_VALIDER), 'dpaeTraitementRh');
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_MODIFIER), 'dpaeModification');
  assert.throws(() => statutsDpae.permissionPourAction('inconnue'), /permission absente ou ambiguë/);
});

test('listeSql : codes entre apostrophes, séparés par des virgules', () => {
  assert.equal(statutsDpae.listeSql(statutsDpae.STATUTS_A_TRAITER_RH), "'envoyee', 'en_attente'");
});
