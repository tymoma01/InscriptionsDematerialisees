const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const pieceJustificativeRepository = require('../../core/dossier/pieceJustificativeRepository');
const typesPiecesRouter = require('./typesPieces.routes');

function gestionnaireGet() {
  const couche = typesPiecesRouter.stack.find((c) => c.route && c.route.path === '/' && c.route.methods.get);
  const pile = couche.route.stack;
  return { garde: pile[0].handle, gestionnaire: pile[pile.length - 1].handle };
}

test('GET /api/types-pieces : refusé sans session', () => {
  const { garde } = gestionnaireGet();
  let statut = null;
  const res = { status: (code) => ((statut = code), res), json: () => res };
  let suivant = false;
  garde({ session: {} }, res, () => {
    suivant = true;
  });
  assert.equal(suivant, false);
  assert.equal(statut, 401);
});

test('GET /api/types-pieces : renvoie la liste de l’entité au format du front (camelCase, sans codeVerso vide)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => knex({ client: 'pg' }));
  const listerMock = t.mock.method(pieceJustificativeRepository, 'listerTypesPiecesAffiches', async () => [
    { code: 'photo_identite', libelle: "Photo d'identité", obligatoire: true, capture_uniquement: true, multiple: false, code_verso: null },
    { code: 'carte_identite', libelle: 'CNI', obligatoire: true, capture_uniquement: false, multiple: false, code_verso: 'carte_identite_verso' },
  ]);
  const { gestionnaire } = gestionnaireGet();
  let corps = null;
  await gestionnaire({ entite: { id: 7 } }, { json: (valeur) => (corps = valeur) }, (erreur) => assert.fail(erreur));

  assert.equal(listerMock.mock.calls[0].arguments[1], 7);
  assert.deepEqual(corps.typesPieces, [
    { code: 'photo_identite', libelle: "Photo d'identité", obligatoire: true, captureUniquement: true, multiple: false, codeVerso: undefined },
    { code: 'carte_identite', libelle: 'CNI', obligatoire: true, captureUniquement: false, multiple: false, codeVerso: 'carte_identite_verso' },
  ]);
});
