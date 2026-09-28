const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const notificationRepository = require('./notificationRepository');
const notificationService = require('./notificationService');

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

test('compterNonLues renvoie un nombre, pas la chaîne renvoyée par count()', async (t) => {
  mockerKnex(t);
  t.mock.method(notificationRepository, 'compterNonLues', async () => ({ total: '3' }));

  const total = await notificationService.compterNonLues(1);

  assert.equal(total, 3);
  assert.equal(typeof total, 'number');
});

test('marquerLue délègue au repository avec utilisateurId et id', async (t) => {
  mockerKnex(t);
  const marquerLueMock = t.mock.method(notificationRepository, 'marquerLue', async () => {});

  await notificationService.marquerLue(1, 42);

  assert.deepEqual(marquerLueMock.mock.calls[0].arguments.slice(1), [1, 42]);
});

test('marquerToutesLues délègue au repository avec utilisateurId', async (t) => {
  mockerKnex(t);
  const marquerToutesLuesMock = t.mock.method(notificationRepository, 'marquerToutesLues', async () => {});

  await notificationService.marquerToutesLues(1);

  assert.deepEqual(marquerToutesLuesMock.mock.calls[0].arguments.slice(1), [1]);
});
