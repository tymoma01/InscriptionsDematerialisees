const test = require('node:test');
const assert = require('node:assert/strict');

const { requirePermission } = require('./rbac.middleware');

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

function executer(cle, utilisateur) {
  const res = creerResFactice();
  let nextAppele = false;
  requirePermission(cle)({ utilisateur }, res, () => {
    nextAppele = true;
  });
  return { nextAppele, res };
}

test('requirePermission laisse passer un rôle autorisé', () => {
  const { nextAppele, res } = executer('forcerStatut', { roleCode: 'planning' });
  assert.equal(nextAppele, true);
  assert.equal(res.statutEnvoye, null);
});

test('requirePermission renvoie 403 à un rôle non autorisé', () => {
  const { nextAppele, res } = executer('forcerStatut', { roleCode: 'accueil_coordination' });
  assert.equal(nextAppele, false);
  assert.equal(res.statutEnvoye, 403);
  assert.deepEqual(res.corpsEnvoye, { erreur: 'Rôle insuffisant pour cette action.' });
});

test('requirePermission renvoie 403 sans utilisateur', () => {
  const { nextAppele, res } = executer('gestionPieces', undefined);
  assert.equal(nextAppele, false);
  assert.equal(res.statutEnvoye, 403);
});

test('requirePermission refuse une clé inconnue dès le montage de la route', () => {
  assert.throws(() => requirePermission('inexistante'), /Permission inconnue/);
});
