const test = require('node:test');
const assert = require('node:assert/strict');
const { enregistrerAction } = require('./journalAudit');

// bd factice : capture les valeurs passées à .insert() sans toucher de vraie base, comme
// enregistrerAction ne fait rien d'autre qu'un insert simple.
function bdFactice(capture) {
  return () => ({
    insert: async (valeurs) => {
      capture.valeurs = valeurs;
    },
  });
}

test("enregistrerAction : adresseIp absente/undefined -> sentinel 'inconnue' (req.ip s'est déjà révélé vide en pratique)", async () => {
  const capture = {};
  await enregistrerAction(bdFactice(capture), {
    entiteId: 1,
    action: 'test_action',
    tableCible: 'dossiers',
    adresseIp: undefined,
  });
  assert.equal(capture.valeurs.adresse_ip, 'inconnue');
});

test('enregistrerAction : adresseIp vide (chaîne vide) -> sentinel également', async () => {
  const capture = {};
  await enregistrerAction(bdFactice(capture), {
    entiteId: 1,
    action: 'test_action',
    tableCible: 'dossiers',
    adresseIp: '',
  });
  assert.equal(capture.valeurs.adresse_ip, 'inconnue');
});

test('enregistrerAction : adresseIp fournie -> conservée telle quelle', async () => {
  const capture = {};
  await enregistrerAction(bdFactice(capture), {
    entiteId: 1,
    action: 'test_action',
    tableCible: 'dossiers',
    adresseIp: '127.0.0.1',
  });
  assert.equal(capture.valeurs.adresse_ip, '127.0.0.1');
});

test('enregistrerAction : cibleId absent -> sentinel 0 (comportement déjà existant, non régressé)', async () => {
  const capture = {};
  await enregistrerAction(bdFactice(capture), {
    entiteId: 1,
    action: 'test_action',
    tableCible: 'dossiers',
    adresseIp: '127.0.0.1',
  });
  assert.equal(capture.valeurs.cible_id, 0);
});
