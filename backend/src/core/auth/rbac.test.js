const test = require('node:test');
const assert = require('node:assert/strict');

const { ROLES, ROLES_ACCUEIL, ROLES_FORCAGE, utilisateurARole } = require('./rbac');

// Rôle Planning (bloc 3, audit 2026-09-25) : exactement les droits d'Accueil/Coordination + le
// droit de forcer un statut — vérifié ici au niveau des deux groupes centralisés, réutilisés par
// les 16 gates de route (Accueil) + POST /forcer-statut (Forçage), voir leur propre fichier.
test('ROLES_ACCUEIL contient accueil_coordination et planning, rien d’autre', () => {
  assert.deepEqual([...ROLES_ACCUEIL].sort(), ['accueil_coordination', 'planning'].sort());
});

test('ROLES_FORCAGE contient admin et planning, rien d’autre', () => {
  assert.deepEqual([...ROLES_FORCAGE].sort(), ['admin', 'planning'].sort());
});

test('utilisateurARole : un compte Planning est accepté partout où ROLES_ACCUEIL est utilisé', () => {
  assert.equal(utilisateurARole({ roleCode: ROLES.PLANNING }, ...ROLES_ACCUEIL), true);
});

test('utilisateurARole : un compte Planning est accepté partout où ROLES_FORCAGE est utilisé (POST /forcer-statut)', () => {
  assert.equal(utilisateurARole({ roleCode: ROLES.PLANNING }, ...ROLES_FORCAGE), true);
});

// Non-régression : Accueil/Coordination seul (sans être aussi Admin/Planning) reste refusé pour le
// forçage — c'est justement le comportement inchangé que le bloc 3 ne doit PAS élargir.
test('utilisateurARole : un compte Accueil/Coordination seul reste refusé pour ROLES_FORCAGE (403 attendu sur /forcer-statut)', () => {
  assert.equal(utilisateurARole({ roleCode: ROLES.ACCUEIL_COORDINATION }, ...ROLES_FORCAGE), false);
});

// Non-régression : Formateur/Inspecteur, non concernés par ce chantier, restent refusés des deux
// côtés.
test('utilisateurARole : Formateur/Inspecteur restent refusés pour ROLES_ACCUEIL et ROLES_FORCAGE', () => {
  for (const roleCode of [ROLES.FORMATEUR, ROLES.INSPECTEUR]) {
    assert.equal(utilisateurARole({ roleCode }, ...ROLES_ACCUEIL), false);
    assert.equal(utilisateurARole({ roleCode }, ...ROLES_FORCAGE), false);
  }
});

// Non-régression : Admin force toujours (déjà couvert avant ce bloc, revérifié ici au niveau du
// groupe centralisé).
test('utilisateurARole : Admin reste accepté pour ROLES_FORCAGE', () => {
  assert.equal(utilisateurARole({ roleCode: ROLES.ADMIN }, ...ROLES_FORCAGE), true);
});
