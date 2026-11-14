// Codes de rôles — cohérents avec la table `roles`. Les droits de chaque rôle sont définis dans
// permissions.js (matrice unique), jamais ici.
//
// - ACCUEIL_COORDINATION : saisie, pièces, planification des tests, relances.
// - PLANNING (affiché « Planning Hôtellerie ») : droits d'Accueil/Coordination + forçage de statut + DPAE
//   de l'Hôtellerie. PLANNING_TERTIAIRE (« Planning Tertiaire ») : mêmes droits, limité au Tertiaire et
//   traite lui-même les DPAE du Tertiaire. Les deux sont une seule définition de droits paramétrée par
//   entité (PLANNING_PAR_ENTITE, permissions.js).
// - FORMATEUR (affiché « Formateur Hôtellerie ») : évalue les tests hôtellerie.
// - INSPECTEUR (affiché « Formateur Tertiaire ») : évalue les tests bureau. Le périmètre « bureau
//   uniquement » est procédural : rien n'empêche techniquement de l'assigner à un test hôtel.
// - INSPECTEUR_HOTELLERIE (affiché « Inspecteur ») : consultation des dossiers Hôtellerie de son
//   périmètre (filtré côté serveur, voir perimetreDossiers.js) + DPAE comme Planning. Aucune
//   action sur un dossier. Code distinct de 'inspecteur' : les comparaisons de rôle sont toujours
//   exactes, jamais par préfixe.
// - ADMIN : tous les droits.
// - RH : traitement des demandes DPAE, consultation des dossiers.
// - SYSTEME : jamais connecté (compte inactif) ; sert d'auteur aux transitions automatiques pour
//   que historique_statuts.utilisateur_id reste exact (traçabilité RGPD).
const ROLES = Object.freeze({
  ACCUEIL_COORDINATION: 'accueil_coordination',
  PLANNING: 'planning',
  PLANNING_TERTIAIRE: 'planning_tertiaire',
  FORMATEUR: 'formateur',
  INSPECTEUR: 'inspecteur',
  INSPECTEUR_HOTELLERIE: 'inspecteur_hotellerie',
  ADMIN: 'admin',
  RH: 'rh',
  SYSTEME: 'systeme',
});

// Entités d'une demande DPAE (colonne `division`) : une demande dont la division n'est pas « tertiaire »
// (Hôtellerie, « autre », ancienne demande sans division) relève de l'Hôtellerie.
const ENTITES = Object.freeze({ HOTELLERIE: 'hotellerie', TERTIAIRE: 'tertiaire' });

// Planning de chaque entité : seule définition du périmètre du Planning.
const PLANNING_PAR_ENTITE = Object.freeze({
  [ENTITES.HOTELLERIE]: ROLES.PLANNING,
  [ENTITES.TERTIAIRE]: ROLES.PLANNING_TERTIAIRE,
});
const ROLES_PLANNING = Object.freeze(Object.values(PLANNING_PAR_ENTITE));

// Entité DPAE à laquelle un rôle est limité ; un rôle absent (Admin) n'est limité à aucune entité.
// L'Inspecteur Hôtellerie et la RH sont limités à l'Hôtellerie ; le Formateur Tertiaire (code
// « inspecteur ») et le Planning Tertiaire au Tertiaire.
const ENTITE_DPAE_PAR_ROLE = Object.freeze({
  [ROLES.PLANNING]: ENTITES.HOTELLERIE,
  [ROLES.INSPECTEUR_HOTELLERIE]: ENTITES.HOTELLERIE,
  [ROLES.RH]: ENTITES.HOTELLERIE,
  [ROLES.PLANNING_TERTIAIRE]: ENTITES.TERTIAIRE,
  [ROLES.INSPECTEUR]: ENTITES.TERTIAIRE,
});

module.exports = { ROLES, ENTITES, PLANNING_PAR_ENTITE, ROLES_PLANNING, ENTITE_DPAE_PAR_ROLE };
