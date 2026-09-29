const test = require('node:test');
const assert = require('node:assert/strict');

const { requireRole } = require('../middlewares/rbac.middleware');
const sitesAffectationRouter = require('./sitesAffectation.routes');

const { siteBodySchema, ROLES_SITES_AFFECTATION } = sitesAffectationRouter;

// POST /api/sites-affectation (2026-09-29) — aucune infrastructure de test HTTP dans ce projet
// (voir dossiers.routes.test.js) : on teste le VRAI schéma et la VRAIE liste de rôles montés sur la
// route, exportés par sitesAffectation.routes.js. Les doublons sont testés côté service
// (siteAffectationService.test.js), qui porte cette règle.
function appelerGardeRole(roleCode) {
  const res = { statutEnvoye: null };
  res.status = (code) => {
    res.statutEnvoye = code;
    return res;
  };
  res.json = () => res;
  let nextAppele = false;
  requireRole(...ROLES_SITES_AFFECTATION)({ utilisateur: { roleCode } }, res, () => {
    nextAppele = true;
  });
  return { nextAppele, statut: res.statutEnvoye };
}

test('POST /api/sites-affectation : nom et initiales valides -> acceptés (espaces retirés)', () => {
  assert.deepEqual(siteBodySchema.parse({ nom: '  NOUVEL HOTEL  ', initiales: ' NH ' }), { nom: 'NOUVEL HOTEL', initiales: 'NH' });
  for (const initiales of ['AB', 'ASP13', 'L2G', 'B55']) {
    assert.equal(siteBodySchema.safeParse({ nom: 'X', initiales }).success, true, initiales);
  }
});

test('POST /api/sites-affectation : initiales au format invalide -> refus (minuscules, symboles, longueur hors 2 à 5)', () => {
  for (const initiales of ['ab', 'Ab', 'A', 'ABCDEF', 'A-B', 'A B', 'É1']) {
    const resultat = siteBodySchema.safeParse({ nom: 'X', initiales });
    assert.equal(resultat.success, false, initiales);
    assert.deepEqual(
      resultat.error.flatten().fieldErrors.initiales,
      ['Les initiales doivent contenir de 2 à 5 caractères, en majuscules et chiffres uniquement.'],
      initiales,
    );
  }
});

test('POST /api/sites-affectation : nom ou initiales manquants -> refus', () => {
  assert.equal(siteBodySchema.safeParse({ nom: '   ', initiales: 'AB' }).success, false);
  assert.equal(siteBodySchema.safeParse({ nom: 'X', initiales: '' }).success, false);
  assert.equal(siteBodySchema.safeParse({}).success, false);
});

test('POST /api/sites-affectation : Accueil/Coordination, Planning et Admin autorisés', () => {
  for (const roleCode of ['accueil_coordination', 'planning', 'admin']) {
    assert.equal(appelerGardeRole(roleCode).nextAppele, true, roleCode);
  }
});

test('POST /api/sites-affectation : rôle non autorisé (Formateur, Inspecteur, RH) -> 403', () => {
  for (const roleCode of ['formateur', 'inspecteur', 'rh']) {
    const { nextAppele, statut } = appelerGardeRole(roleCode);
    assert.equal(nextAppele, false, roleCode);
    assert.equal(statut, 403, roleCode);
  }
});
