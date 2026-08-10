const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const lieuRepository = require('./lieuRepository');
const lieuService = require('./lieuService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

test('creerLieu dérive un code à partir du libellé (accents retirés, tout non-alphanumérique réduit à "_")', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParCode', async () => undefined);
  let codeRecu;
  t.mock.method(lieuRepository, 'creerLieu', async (bd, entiteId, { code, libelle }) => {
    codeRecu = code;
    return [{ id: 42, code, libelle, actif: true }];
  });

  const lieu = await lieuService.creerLieu(ENTITE_ACCECIT, {
    libelle: 'Hôtel du Cadran - 14 rue de Valadon, 75007 Paris',
  });

  assert.equal(codeRecu, 'hotel_du_cadran_14_rue_de_valadon_75007_paris');
  assert.equal(lieu.id, 42);
  assert.equal(lieu.libelle, 'Hôtel du Cadran - 14 rue de Valadon, 75007 Paris');
});

test("creerLieu ajoute un suffixe numérique si le code généré est déjà pris par un lieu de l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParCode', async (bd, entiteId, code) =>
    code === 'agence' ? { id: 1, code } : undefined,
  );
  let codeRecu;
  t.mock.method(lieuRepository, 'creerLieu', async (bd, entiteId, { code, libelle }) => {
    codeRecu = code;
    return [{ id: 43, code, libelle, actif: true }];
  });

  await lieuService.creerLieu(ENTITE_ACCECIT, { libelle: 'Agence' });

  assert.equal(codeRecu, 'agence_2');
});

test('creerLieu retombe sur le code "lieu" si le libellé ne contient aucun caractère alphanumérique', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParCode', async () => undefined);
  let codeRecu;
  t.mock.method(lieuRepository, 'creerLieu', async (bd, entiteId, { code, libelle }) => {
    codeRecu = code;
    return [{ id: 44, code, libelle, actif: true }];
  });

  await lieuService.creerLieu(ENTITE_ACCECIT, { libelle: '---' });

  assert.equal(codeRecu, 'lieu');
});
