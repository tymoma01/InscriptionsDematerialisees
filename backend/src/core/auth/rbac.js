// Codes de rôles — cohérents avec la table `roles` (migration 002_creation_table_roles.js) et
// CLAUDE.md, section Authentification et rôles. Générique par nature (pas propre à ACCECIT,
// voir Modularité) : la table `roles` reste globale, sans entite_id (voir
// docs/schema-bdd-proposition.md), ces 4 codes sont donc valables pour toute entité du projet.
const ROLES = Object.freeze({
  ACCUEIL_COORDINATION: 'accueil_coordination',
  RECRUTEUR: 'recruteur',
  FORMATEUR: 'formateur',
  ADMIN: 'admin',
});

// utilisateur est le payload minimal posé en session par authService.connecter — voir
// core/auth/session.js et api/middlewares/auth.middleware.js.
function utilisateurARole(utilisateur, ...codesAutorises) {
  return Boolean(utilisateur) && codesAutorises.includes(utilisateur.roleCode);
}

module.exports = { ROLES, utilisateurARole };
