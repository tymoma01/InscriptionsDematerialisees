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
//
// INSPECTEUR : évalue les candidats sur les postes bureau (nettoyage, vitrerie, machiniste,
// chef_equipe, autres — voir postesConstantes.js), équivalent de FORMATEUR pour le hôtel mais sur
// un périmètre distinct. Scope "bureau uniquement" **procédural**, pas techniquement imposé : rien
// dans le code ne vérifie qu'un Inspecteur n'est assigné qu'à des tests bureau — la garantie tient
// à ce que Accueil/Coordination ne l'assigne jamais à un test hôtel (voir
// utilisateurService.listerFormateursEtInspecteurs, rendezvousService.js). Décision actée : audit
// KPI Dashboard / rôle Inspecteur.
// RECRUTEUR retiré (audit 2026-08-27) : plus aucune fonction dans le workflow v4 d'ACCECIT —
// rôle supprimé de la table `roles` en base, les 8 comptes qui le portaient désactivés.
//
// PLANNING ajouté (audit 2026-09-25, rôle « Planning ») : exactement les droits d'Accueil/
// Coordination (voir ROLES_ACCUEIL ci-dessous) + le droit de forcer un statut (voir ROLES_FORCAGE),
// jamais un rôle à part entière avec ses propres routes/transition_roles distincts — c'est
// pourquoi il n'apparaît JAMAIS seul dans le code, toujours via l'un de ces deux groupes.
//
// RH ajouté (module Demandes DPAE, 2026-09-28) : traite/valide/rejette les demandes DPAE
// (accueilCoordination/planning/admin les créent, voir ROLES_DPAE_DEMANDEUR ci-dessous) — rôle à
// part entière, pas un alias d'un groupe existant (contrairement à Planning), avec ses propres
// routes (api/routes/dpae.routes.js).
//
// Libellés affichés (2026-10-01, `roles.libelle`, migration 073) : 'formateur' s'affiche « Formateur
// Hôtellerie » et 'inspecteur' « Formateur Tertiaire » — codes techniques INCHANGÉS.
//
// INSPECTEUR_HOTELLERIE ajouté (2026-10-01, migration 073) : rôle de CONSULTATION limité aux dossiers
// du secteur Hôtellerie à certains statuts (périmètre appliqué côté serveur, voir
// core/auth/perimetreDossiers.js), plus création/suivi des demandes DPAE comme Planning. Aucune
// action sur un dossier, aucune transition (aucune ligne transition_roles). Code distinct de
// 'inspecteur' : toutes les comparaisons de rôle du projet sont EXACTES (===, includes sur une
// liste), jamais par préfixe ou sous-chaîne — les deux ne sont jamais confondus.
const ROLES = Object.freeze({
  ACCUEIL_COORDINATION: 'accueil_coordination',
  PLANNING: 'planning',
  FORMATEUR: 'formateur',
  INSPECTEUR: 'inspecteur',
  INSPECTEUR_HOTELLERIE: 'inspecteur_hotellerie',
  ADMIN: 'admin',
  RH: 'rh',
  SYSTEME: 'systeme',
});

// Groupes de rôles centralisés (audit 2026-09-25) : évite de dupliquer `[ROLES.ACCUEIL_COORDINATION,
// ROLES.PLANNING]`/`[ROLES.ADMIN, ROLES.PLANNING]` dans les 16+ gates de route qui en avaient
// besoin — un seul endroit à modifier si un futur rôle rejoint l'un de ces deux groupes. Toujours
// utilisés via spread (`...ROLES_ACCUEIL`) dans un appel `requireRole(...)`/un tableau `ROLES_*`
// existant, jamais réassignés ni mutés (voir Object.freeze ci-dessous).
//
// ROLES_ACCUEIL : tout ce qu'Accueil/Coordination peut faire — Planning en hérite intégralement.
const ROLES_ACCUEIL = Object.freeze([ROLES.ACCUEIL_COORDINATION, ROLES.PLANNING]);
// ROLES_FORCAGE : qui peut forcer le statut d'un dossier (POST /forcer-statut) — Admin, plus
// Planning (voir transitions.routes.js ROLES_FORCAGE, workflowEngine.forcerStatut).
const ROLES_FORCAGE = Object.freeze([ROLES.ADMIN, ROLES.PLANNING]);
// Périmètre DPAE (révisé le 2026-09-30, demande utilisateur) — l'Admin a TOUTES les actions DPAE ;
// Accueil/Coordination n'a PLUS AUCUN accès (ni création, ni consultation, ni ajout de site) ;
// tout autre rôle non listé ici : aucun accès.
//
// ROLES_DPAE_DEMANDEUR : qui peut créer une demande DPAE (dpae.routes.js, POST /), ajouter/lister
// les sites d'affectation (sitesAffectation.routes.js) et rechercher un candidat pour le champ
// « Nom » du formulaire (candidats.routes.js, GET /recherche) — Planning et Admin. Accueil/
// Coordination retiré (auparavant ...ROLES_ACCUEIL).
// Inspecteur Hôtellerie ajouté le 2026-10-01 (création et ajout de site, comme Planning).
const ROLES_DPAE_DEMANDEUR = Object.freeze([ROLES.PLANNING, ROLES.ADMIN, ROLES.INSPECTEUR_HOTELLERIE]);
// ROLES_DPAE_RH : traitement RH d'une demande (file RH, valider/rejeter) — RH et Admin, inchangé.
const ROLES_DPAE_RH = Object.freeze([ROLES.RH, ROLES.ADMIN]);
// ROLES_DPAE_CONSULTATION : qui peut consulter des demandes DPAE (liste de suivi, fiche).
// Inspecteur Hôtellerie ajouté le 2026-10-01 (suivi et fiches).
const ROLES_DPAE_CONSULTATION = Object.freeze([ROLES.ADMIN, ROLES.RH, ROLES.PLANNING, ROLES.INSPECTEUR_HOTELLERIE]);
// ROLES_DPAE_CONSULTATION_TOUTES : parmi eux, qui voit TOUTES les demandes de l'entité (filtre
// « Mes demandes / Toutes ») — les autres ne voient que les demandes dont ils sont l'auteur.
// Planning ajouté le 2026-09-30 (décision utilisateur confirmée) : il ne voyait jusqu'ici que ses
// propres demandes. Miroir : frontend/src/core/auth/rolesGroupes.js.
// Inspecteur Hôtellerie ajouté le 2026-10-01 (« Toutes » par défaut, comme Planning).
const ROLES_DPAE_CONSULTATION_TOUTES = Object.freeze([ROLES.ADMIN, ROLES.RH, ROLES.PLANNING, ROLES.INSPECTEUR_HOTELLERIE]);
// Tableau de bord DPAE et notes d'une demande (2026-10-01) : périmètre historique de
// ROLES_DPAE_CONSULTATION, figé ici quand l'Inspecteur Hôtellerie a rejoint la consultation — il n'a
// NI le tableau de bord DPAE NI l'ajout de notes. Miroir : frontend/src/core/auth/rolesGroupes.js.
const ROLES_DPAE_TABLEAU_DE_BORD = Object.freeze([ROLES.ADMIN, ROLES.RH, ROLES.PLANNING]);
const ROLES_DPAE_NOTES = Object.freeze([ROLES.ADMIN, ROLES.RH, ROLES.PLANNING]);

// utilisateur est le payload minimal posé en session par authService.connecter — voir
// core/auth/session.js et api/middlewares/auth.middleware.js.
function utilisateurARole(utilisateur, ...codesAutorises) {
  return Boolean(utilisateur) && codesAutorises.includes(utilisateur.roleCode);
}

module.exports = {
  ROLES,
  ROLES_ACCUEIL,
  ROLES_FORCAGE,
  ROLES_DPAE_DEMANDEUR,
  ROLES_DPAE_RH,
  ROLES_DPAE_CONSULTATION,
  ROLES_DPAE_CONSULTATION_TOUTES,
  ROLES_DPAE_TABLEAU_DE_BORD,
  ROLES_DPAE_NOTES,
  utilisateurARole,
};
