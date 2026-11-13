const test = require('node:test');
const assert = require('node:assert/strict');

const { ROLES } = require('../../core/auth/rbac');
const transitionsRouter = require('./transitions.routes');

// Gardes testées sur le VRAI routeur (même patron que forcageEtNotesRh.test.js).
const ENTITE = { id: 1, code: 'accecit' };

function passeLesGardes(chemin, roleCode) {
  const couche = transitionsRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods.post);
  assert.ok(couche, `POST ${chemin} introuvable`);
  const gardes = [...transitionsRouter.stack.filter((c) => !c.route).map((c) => c.handle), ...couche.route.stack.slice(0, -1).map((c) => c.handle)];
  const req = { session: { utilisateur: { id: 9, roleCode, entiteId: ENTITE.id } }, entite: ENTITE, params: {}, query: {}, body: {} };
  const res = { statut: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = () => res;
  for (const garde of gardes) {
    let suivant = false;
    garde(req, res, () => {
      suivant = true;
    });
    if (!suivant) return { autorise: false, statut: res.statut };
  }
  return { autorise: true, statut: null };
}

test('POST /blacklister : tous les rôles du back-office atteignent le service', () => {
  for (const role of [ROLES.ACCUEIL_COORDINATION, ROLES.PLANNING, ROLES.FORMATEUR, ROLES.INSPECTEUR, ROLES.INSPECTEUR_HOTELLERIE, ROLES.ADMIN, ROLES.RH]) {
    assert.equal(passeLesGardes('/blacklister', role).autorise, true, role);
  }
});

test('POST /retirer-blacklist : pas de garde générique, le service renvoie le message explicite', () => {
  // Aucune garde de route : un rôle non Admin atteint le service, qui répond 403 avec son message.
  for (const role of [ROLES.FORMATEUR, ROLES.ADMIN]) {
    assert.equal(passeLesGardes('/retirer-blacklist', role).autorise, true, role);
  }
});
