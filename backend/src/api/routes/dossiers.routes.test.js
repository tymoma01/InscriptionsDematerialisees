const test = require('node:test');
const assert = require('node:assert/strict');

const { requirePermission } = require('../middlewares/rbac.middleware');
const dossiersRouter = require('./dossiers.routes');

// Audit 2026-09-26 : retrait de l'Inspecteur de "Suivi des formations" (règle métier confirmée —
// aucun dossier Tertiaire, le secteur de l'Inspecteur, ne passe en formation). Aucune
// infrastructure de test HTTP dans ce projet : on teste la permission réellement utilisée par la
// route (core/auth/permissions.js), jamais une copie de la liste de rôles.
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

test('GET /dossiers/suivi-formation : Inspecteur reçoit 403 (retiré de suiviFormation)', () => {
  const middleware = requirePermission('suiviFormation');
  const { nextAppele, res } = appelerMiddleware(middleware, 'inspecteur');
  assert.equal(nextAppele, false);
  assert.equal(res.statutEnvoye, 403);
  assert.deepEqual(res.corpsEnvoye, { erreur: 'Rôle insuffisant pour cette action.' });
});

test('GET /dossiers/suivi-formation : Formateur, Admin, Accueil/Coordination et Planning inchangés (toujours acceptés)', () => {
  const middleware = requirePermission('suiviFormation');
  for (const roleCode of ['formateur', 'admin', 'accueil_coordination', 'planning']) {
    const { nextAppele, res } = appelerMiddleware(middleware, roleCode);
    assert.equal(nextAppele, true, `${roleCode} devrait être accepté`);
    assert.equal(res.statutEnvoye, null, `${roleCode} ne devrait recevoir aucun 403`);
  }
});

test("GET /dossiers/:dossierId/formation (historique, fiche dossier) : Inspecteur GARDE l'accès (lectureFormation)", () => {
  const middleware = requirePermission('lectureFormation');
  const { nextAppele, res } = appelerMiddleware(middleware, 'inspecteur');
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});

test('POST /transitions (garde générique) : Inspecteur GARDE l\'accès (gestionTransitions — ses évaluations en dépendent)', () => {
  const middleware = requirePermission('gestionTransitions');
  const { nextAppele, res } = appelerMiddleware(middleware, 'inspecteur');
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});

// POST /dossiers/:dossierId/disponibilite-embauche (audit 2026-09-28, correction de
// disponibilité "Validé - prêt à l'embauche") — permission modificationInscription.
test('POST /dossiers/:dossierId/disponibilite-embauche : Formateur et Inspecteur reçoivent 403', () => {
  const middleware = requirePermission('modificationInscription');
  for (const roleCode of ['formateur', 'inspecteur']) {
    const { nextAppele, res } = appelerMiddleware(middleware, roleCode);
    assert.equal(nextAppele, false, `${roleCode} devrait être refusé`);
    assert.equal(res.statutEnvoye, 403);
    assert.deepEqual(res.corpsEnvoye, { erreur: 'Rôle insuffisant pour cette action.' });
  }
});

test('POST /dossiers/:dossierId/disponibilite-embauche : Accueil/Coordination, Planning et Admin sont acceptés', () => {
  const middleware = requirePermission('modificationInscription');
  for (const roleCode of ['accueil_coordination', 'planning', 'admin']) {
    const { nextAppele, res } = appelerMiddleware(middleware, roleCode);
    assert.equal(nextAppele, true, `${roleCode} devrait être accepté`);
    assert.equal(res.statutEnvoye, null);
  }
});

// GET /dossiers/derniere-modification (actualisation automatique du back-office) — RH ajoutée le
// 2026-09-30. Garde RÉELLEMENT montée sur la route, lue dans la pile du routeur (jamais une copie).
test('GET /dossiers/derniere-modification : RH autorisée (actualisation automatique), comme les autres rôles back-office', () => {
  const couche = dossiersRouter.stack.find((c) => c.route && c.route.path === '/derniere-modification' && c.route.methods.get);
  assert.ok(couche, 'route GET /derniere-modification introuvable');
  const garde = couche.route.stack[0].handle;
  for (const roleCode of ['rh', 'accueil_coordination', 'planning', 'formateur', 'inspecteur', 'admin']) {
    const { nextAppele, res } = appelerMiddleware(garde, roleCode);
    assert.equal(nextAppele, true, `${roleCode} devrait être accepté`);
    assert.equal(res.statutEnvoye, null, roleCode);
  }
  // Le rôle technique « systeme » (jamais connecté) reste exclu.
  assert.equal(appelerMiddleware(garde, 'systeme').res.statutEnvoye, 403);
});
