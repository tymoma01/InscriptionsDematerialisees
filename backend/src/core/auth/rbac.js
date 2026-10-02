// Codes de rôles — cohérents avec la table `roles`. Les droits de chaque rôle sont définis dans
// permissions.js (matrice unique), jamais ici.
//
// - ACCUEIL_COORDINATION : saisie, pièces, planification des tests, relances.
// - PLANNING : droits d'Accueil/Coordination + forçage de statut + création de DPAE.
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
  FORMATEUR: 'formateur',
  INSPECTEUR: 'inspecteur',
  INSPECTEUR_HOTELLERIE: 'inspecteur_hotellerie',
  ADMIN: 'admin',
  RH: 'rh',
  SYSTEME: 'systeme',
});

module.exports = { ROLES };
