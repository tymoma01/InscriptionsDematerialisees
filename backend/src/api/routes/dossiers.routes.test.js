const test = require('node:test');
const assert = require('node:assert/strict');

const { requireRole } = require('../middlewares/rbac.middleware');
const dossiersRouter = require('./dossiers.routes');
const formationRouter = require('./formation.routes');
const transitionsRouter = require('./transitions.routes');

// Audit 2026-09-26 : retrait de l'Inspecteur de "Suivi des formations" (règle métier confirmée —
// aucun dossier Tertiaire, le secteur de l'Inspecteur, ne passe en formation). Aucune
// infrastructure de test HTTP dans ce projet (voir rbac.middleware.test.js/transitions.routes.js) :
// les constantes de rôles réelles sont importées directement depuis chaque module de route
// (attachées à l'objet router, voir leur commentaire d'export respectif), jamais dupliquées/
// devinées ici — un test qui dériverait silencieusement de la vraie liste serait pire qu'aucun
// test.
function creerResFactice() {
  const res = { statutEnvoye: null, corpsEnvoye: null };
  res.status = (code) => {
    res.statutEnvoye = code;
    return res;
  };
  res.json = (corps) => {
    res.corpsEnvoye = corps;
    return res;
  };
  return res;
}

function appelerMiddleware(middleware, roleCode) {
  const res = creerResFactice();
  let nextAppele = false;
  middleware({ utilisateur: { roleCode } }, res, () => {
    nextAppele = true;
  });
  return { nextAppele, res };
}

test('GET /dossiers/suivi-formation : Inspecteur reçoit 403 (retiré de ROLES_SUIVI_FORMATION)', () => {
  const middleware = requireRole(...dossiersRouter.ROLES_SUIVI_FORMATION);
  const { nextAppele, res } = appelerMiddleware(middleware, 'inspecteur');
  assert.equal(nextAppele, false);
  assert.equal(res.statutEnvoye, 403);
  assert.deepEqual(res.corpsEnvoye, { erreur: 'Rôle insuffisant pour cette action.' });
});

test('GET /dossiers/suivi-formation : Formateur, Admin, Accueil/Coordination et Planning inchangés (toujours acceptés)', () => {
  const middleware = requireRole(...dossiersRouter.ROLES_SUIVI_FORMATION);
  for (const roleCode of ['formateur', 'admin', 'accueil_coordination', 'planning']) {
    const { nextAppele, res } = appelerMiddleware(middleware, roleCode);
    assert.equal(nextAppele, true, `${roleCode} devrait être accepté`);
    assert.equal(res.statutEnvoye, null, `${roleCode} ne devrait recevoir aucun 403`);
  }
});

test("GET /dossiers/:dossierId/formation (historique, fiche dossier) : Inspecteur GARDE l'accès (ROLES_LECTURE_FORMATION non touché)", () => {
  const middleware = requireRole(...formationRouter.ROLES_LECTURE_FORMATION);
  const { nextAppele, res } = appelerMiddleware(middleware, 'inspecteur');
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});

test('POST /transitions (garde générique) : Inspecteur GARDE l\'accès (ROLES_GESTION_TRANSITIONS non touché — ses évaluations en dépendent)', () => {
  const middleware = requireRole(...transitionsRouter.ROLES_GESTION_TRANSITIONS);
  const { nextAppele, res } = appelerMiddleware(middleware, 'inspecteur');
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});
