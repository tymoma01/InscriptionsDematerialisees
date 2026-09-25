const test = require('node:test');
const assert = require('node:assert/strict');

const { requireRole } = require('./rbac.middleware');
const { ROLES_ACCUEIL, ROLES_FORCAGE } = require('../../core/auth/rbac');

// requireRole(...ROLES_ACCUEIL) / requireRole(...ROLES_FORCAGE) sont EXACTEMENT ce que chacune des
// 16 routes "Accueil" (bloc 3, audit 2026-09-25 — rendezvousDisponibilites/lieux/pieces/
// transitions x2/rendezvous/formation/statistiques/formateurs/dossiers x5/notes/relances.routes.js)
// et POST /forcer-statut (transitions.routes.js) montent réellement — un compte Planning accepté
// ici est donc accepté par CHACUNE de ces routes, sans qu'il soit nécessaire de monter chaque
// fichier de route individuellement (aucune infrastructure de test HTTP/route dans ce projet, voir
// backend/src/api/routes/transitions.routes.test.js pour le même choix).
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

test('requireRole(...ROLES_ACCUEIL) laisse passer un compte Planning (next appelé, aucun 403) — échantillon des 16 routes Accueil', () => {
  const middleware = requireRole(...ROLES_ACCUEIL);
  const res = creerResFactice();
  let nextAppele = false;
  middleware({ utilisateur: { roleCode: 'planning' } }, res, () => {
    nextAppele = true;
  });
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});

test('requireRole(...ROLES_FORCAGE) laisse passer un compte Planning (next appelé, aucun 403) — POST /forcer-statut', () => {
  const middleware = requireRole(...ROLES_FORCAGE);
  const res = creerResFactice();
  let nextAppele = false;
  middleware({ utilisateur: { roleCode: 'planning' } }, res, () => {
    nextAppele = true;
  });
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});

// Non-régression explicite (bloc 3) : un compte Accueil/Coordination reçoit toujours 403 sur
// /forcer-statut — le bloc 3 étend le forçage à Planning, jamais à Accueil/Coordination lui-même.
test("requireRole(...ROLES_FORCAGE) renvoie 403 pour un compte Accueil/Coordination (n'a pas le droit de forçage)", () => {
  const middleware = requireRole(...ROLES_FORCAGE);
  const res = creerResFactice();
  let nextAppele = false;
  middleware({ utilisateur: { roleCode: 'accueil_coordination' } }, res, () => {
    nextAppele = true;
  });
  assert.equal(nextAppele, false);
  assert.equal(res.statutEnvoye, 403);
  assert.deepEqual(res.corpsEnvoye, { erreur: 'Rôle insuffisant pour cette action.' });
});

// Non-régression : Admin/Formateur/Inspecteur inchangés sur ces deux groupes.
test('requireRole(...ROLES_FORCAGE) : Admin toujours accepté, Formateur/Inspecteur toujours refusés', () => {
  const middleware = requireRole(...ROLES_FORCAGE);

  const resAdmin = creerResFactice();
  let nextAdmin = false;
  middleware({ utilisateur: { roleCode: 'admin' } }, resAdmin, () => {
    nextAdmin = true;
  });
  assert.equal(nextAdmin, true);

  for (const roleCode of ['formateur', 'inspecteur']) {
    const res = creerResFactice();
    let nextAppele = false;
    middleware({ utilisateur: { roleCode } }, res, () => {
      nextAppele = true;
    });
    assert.equal(nextAppele, false);
    assert.equal(res.statutEnvoye, 403);
  }
});
