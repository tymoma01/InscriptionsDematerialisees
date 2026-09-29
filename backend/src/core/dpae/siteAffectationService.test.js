const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const siteAffectationRepository = require('./siteAffectationRepository');
const siteAffectationService = require('./siteAffectationService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

// Base factice : le repository applique en SQL la comparaison sans casse (lower(...), voir
// siteAffectationRepository.listerSitesEnConflit) ; on la reproduit ici sur une petite liste.
const SITES_EN_BASE = [
  { id: 1, nom: 'AIGLON', initiales: 'AIG' },
  { id: 2, nom: 'YUNA montmartre', initiales: 'YMO' },
];

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(siteAffectationRepository, 'listerSitesEnConflit', async (_bd, _entiteId, { nom, initiales }) =>
    SITES_EN_BASE.filter(
      (site) => site.nom.toLowerCase() === nom.toLowerCase() || site.initiales.toLowerCase() === initiales.toLowerCase(),
    ),
  );
  return t.mock.method(siteAffectationRepository, 'creerSite', async (_bd, { nom, initiales }) => ({ id: 70, nom, initiales }));
}

test('creerSite : ajout accepté, site renvoyé tel que créé', async (t) => {
  const creerMock = mockerBase(t);

  const site = await siteAffectationService.creerSite(ENTITE_ACCECIT, { nom: 'NOUVEL HOTEL', initiales: 'NH' });

  assert.deepEqual(site, { id: 70, nom: 'NOUVEL HOTEL', initiales: 'NH' });
  assert.deepEqual(creerMock.mock.calls[0].arguments[1], { entiteId: 1, nom: 'NOUVEL HOTEL', initiales: 'NH' });
});

test('creerSite : doublon de nom (sans tenir compte des majuscules) -> refus explicite, rien n\'est créé', async (t) => {
  const creerMock = mockerBase(t);

  await assert.rejects(
    () => siteAffectationService.creerSite(ENTITE_ACCECIT, { nom: 'yuna MONTMARTRE', initiales: 'ZZ' }),
    (erreur) => erreur instanceof siteAffectationService.ErreurSiteAffectationDoublon && erreur.message === 'Un site nommé « YUNA montmartre » existe déjà.',
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test("creerSite : doublon d'initiales -> refus explicite, rien n'est créé", async (t) => {
  const creerMock = mockerBase(t);

  await assert.rejects(
    () => siteAffectationService.creerSite(ENTITE_ACCECIT, { nom: 'AUTRE HOTEL', initiales: 'AIG' }),
    (erreur) =>
      erreur instanceof siteAffectationService.ErreurSiteAffectationDoublon &&
      erreur.message === 'Les initiales « AIG » sont déjà utilisées par le site « AIGLON ».',
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test("creerSite : violation d'unicité levée par la base (ajouts simultanés) -> même refus explicite, jamais une erreur 500", async (t) => {
  mockerBase(t);
  t.mock.method(siteAffectationRepository, 'creerSite', async () => {
    throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  });

  await assert.rejects(
    () => siteAffectationService.creerSite(ENTITE_ACCECIT, { nom: 'NOUVEL HOTEL', initiales: 'NH' }),
    siteAffectationService.ErreurSiteAffectationDoublon,
  );
});
