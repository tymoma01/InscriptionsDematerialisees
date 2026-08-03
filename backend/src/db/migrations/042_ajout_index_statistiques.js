// Index composites ciblés sur les prédicats réels des requêtes du tableau de bord KPI (voir
// core/statistiques/statistiquesRepository.js) — aucune de ces colonnes de filtrage/jointure
// fréquentes n'était indexée jusqu'ici (une contrainte FK ne crée pas d'index automatiquement
// sous Postgres/knex, contrairement à la PK). Composites plutôt que mono-colonne : alignés sur
// l'ordre des prédicats WHERE/JOIN réellement utilisés (entite_id toujours en tête, scope
// multi-entités systématique sur toute requête de ce module).
//
// Numérotée 042, pas 041 : la migration 041 reste réservée au drop de evaluations.poste_code
// (voir commentaire de la migration 040_creation_table_evaluations_postes.js), non abandonnée.
exports.up = async (knex) => {
  await knex.schema.alterTable('dossiers', (table) => {
    // Sert stats "inscrits" (1) et "conversion" (5) : compter les dossiers d'une entité créés sur
    // une période.
    table.index(['entite_id', 'date_creation'], 'idx_dossiers_entite_date_creation');
    // Sert tout filtrage/comptage par statut courant dans une entité (ex. futures variantes
    // d'indicateurs basées sur dossiers.statut_id plutôt que sur l'historique).
    table.index(['entite_id', 'statut_id'], 'idx_dossiers_entite_statut');
  });

  await knex.schema.alterTable('historique_statuts', (table) => {
    // Sert stat "envoyés en test" (2, DISTINCT dossier_id ayant eu le statut test_planifie sur la
    // période) et les deux délais moyens (7, sous-requêtes corrélées
    // dossier_id + statut_id + tri par date_changement).
    table.index(['dossier_id', 'statut_id', 'date_changement'], 'idx_historique_statuts_dossier_statut_date');
  });

  await knex.schema.alterTable('evaluations', (table) => {
    // Sert le JOIN dossiers obligatoire sur toute requête evaluations du module statistiques
    // (evaluations n'a pas de colonne entite_id propre, le scope entité passe par ce join).
    table.index(['dossier_id'], 'idx_evaluations_dossier');
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('dossiers', (table) => {
    table.dropIndex(['entite_id', 'date_creation'], 'idx_dossiers_entite_date_creation');
    table.dropIndex(['entite_id', 'statut_id'], 'idx_dossiers_entite_statut');
  });

  await knex.schema.alterTable('historique_statuts', (table) => {
    table.dropIndex(['dossier_id', 'statut_id', 'date_changement'], 'idx_historique_statuts_dossier_statut_date');
  });

  await knex.schema.alterTable('evaluations', (table) => {
    table.dropIndex(['dossier_id'], 'idx_evaluations_dossier');
  });
};
