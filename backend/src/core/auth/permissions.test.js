const test = require('node:test');
const assert = require('node:assert/strict');

const { ROLES } = require('./rbac');
const { PERMISSIONS, aPermission, permissionsDuRole } = require('./permissions');

const ROLES_CONNUS = new Set(Object.values(ROLES));

test('chaque permission ne référence que des codes de rôle existants', () => {
  for (const [cle, roles] of Object.entries(PERMISSIONS)) {
    for (const roleCode of roles) assert.ok(ROLES_CONNUS.has(roleCode), `${cle} : rôle inconnu « ${roleCode} »`);
  }
});

test('le compte système n’a aucune permission', () => {
  assert.deepEqual(permissionsDuRole(ROLES.SYSTEME), []);
});

// Seule exception : dpaeCreationSoumiseAuPlanning désigne le rôle dont les demandes DPAE passent
// d'abord par le Planning (Inspecteur Hôtellerie) ; l'Admin, lui, envoie directement à la RH.
test('Admin a toutes les permissions', () => {
  const sansAdmin = Object.keys(PERMISSIONS).filter((cle) => !aPermission(ROLES.ADMIN, cle));
  assert.deepEqual(sansAdmin, ['dpaeCreationSoumiseAuPlanning']);
});

// Planning = Accueil/Coordination + forçage + DPAE.
test('Planning a toutes les permissions d’Accueil/Coordination', () => {
  for (const cle of permissionsDuRole(ROLES.ACCUEIL_COORDINATION)) {
    assert.ok(aPermission(ROLES.PLANNING, cle), cle);
  }
});

test('forçage de statut : Admin, Planning et RH uniquement', () => {
  assert.deepEqual([...PERMISSIONS.forcerStatut].sort(), [ROLES.ADMIN, ROLES.PLANNING, ROLES.RH].sort());
});

test('Accueil/Coordination n’a aucun accès DPAE', () => {
  const dpae = permissionsDuRole(ROLES.ACCUEIL_COORDINATION).filter((cle) => cle.startsWith('dpae'));
  assert.deepEqual(dpae, []);
});

test('une permission inconnue lève une erreur plutôt que de refuser silencieusement', () => {
  assert.throws(() => aPermission(ROLES.ADMIN, 'inexistante'), /Permission inconnue/);
});
