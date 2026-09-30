const test = require('node:test');
const assert = require('node:assert/strict');

const { requireRole } = require('../middlewares/rbac.middleware');
const sitesAffectationRouter = require('./sitesAffectation.routes');

const { siteBodySchema, ROLES_SITES_AFFECTATION } = sitesAffectationRouter;

// POST /api/sites-affectation (2026-09-29) — aucune infrastructure de test HTTP dans ce projet
// (voir dossiers.routes.test.js) : on teste le VRAI schéma et la VRAIE liste de rôles montés sur la
// route, exportés par sitesAffectation.routes.js. Les doublons sont testés côté service
// (siteAffectationService.test.js), qui porte cette règle.
// Garde réellement montée sur le routeur (router.use(requireRole(...)), 2e couche après
// requireAuth) — en plus de la liste de rôles exportée, pour ne jamais tester une copie.
function gardeMontee() {
  const couches = sitesAffectationRouter.stack.filter((couche) => !couche.route);
  return couches[1].handle;
}

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
  // Même verdict attendu de la garde réellement montée.
  let nextMonte = false;
  gardeMontee()({ utilisateur: { roleCode } }, { status: () => ({ json: () => {} }) }, () => {
    nextMonte = true;
  });
  assert.equal(nextMonte, nextAppele, `garde montée divergente pour ${roleCode}`);
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

test('POST /api/sites-affectation : Planning et Admin autorisés', () => {
  for (const roleCode of ['planning', 'admin']) {
    assert.equal(appelerGardeRole(roleCode).nextAppele, true, roleCode);
  }
});

// Accueil/Coordination n'a plus aucun accès DPAE depuis le 2026-09-30 (voir rbac.js).
test('POST /api/sites-affectation : rôle non autorisé (Accueil/Coordination, Formateur, Inspecteur, RH) -> 403', () => {
  for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur', 'rh']) {
    const { nextAppele, statut } = appelerGardeRole(roleCode);
    assert.equal(nextAppele, false, roleCode);
    assert.equal(statut, 403, roleCode);
  }
});
