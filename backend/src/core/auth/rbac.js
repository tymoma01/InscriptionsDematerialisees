// Codes de rôles — cohérents avec la table `roles` (migration 002_creation_table_roles.js) et
// CLAUDE.md, section Authentification et rôles. Générique par nature (pas propre à ACCECIT,
// voir Modularité) : la table `roles` reste globale, sans entite_id (voir
// docs/schema-bdd-proposition.md), ces codes sont donc valables pour toute entité du projet.
//
// SYSTEME étend la liste des 4 rôles opérateurs actée avec le développeur senior (voir
// seedRoles.js) — à confirmer avec lui. Ce n'est pas un rôle porteur de permissions (jamais
// vérifié par utilisateurARole, jamais utilisé pour se connecter : l'utilisateur qui le porte
// est créé avec `actif: false`, voir seedUtilisateurSysteme.js). Son seul rôle est de donner un
// `utilisateur_id` exact aux transitions de statut déclenchées automatiquement par le serveur
// (ex : fin de soumission du formulaire d'inscription, aucun agent connecté) — nécessaire pour
// que historique_statuts.utilisateur_id (NOT NULL) reste une valeur qui dit la vérité, plutôt
// qu'un rôle humain utilisé par convention, ce qui fausserait la traçabilité RGPD ("qui, quoi,
// quand", voir CLAUDE.md Contraintes RGPD).
const ROLES = Object.freeze({
  ACCUEIL_COORDINATION: 'accueil_coordination',
  RECRUTEUR: 'recruteur',
  FORMATEUR: 'formateur',
  ADMIN: 'admin',
  SYSTEME: 'systeme',
});

// utilisateur est le payload minimal posé en session par authService.connecter — voir
// core/auth/session.js et api/middlewares/auth.middleware.js.
function utilisateurARole(utilisateur, ...codesAutorises) {
  return Boolean(utilisateur) && codesAutorises.includes(utilisateur.roleCode);
}

module.exports = { ROLES, utilisateurARole };
