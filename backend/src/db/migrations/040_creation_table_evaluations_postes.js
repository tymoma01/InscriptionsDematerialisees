// Sépare le(s) poste(s) effectivement évalués de la ligne `evaluations` elle-même : un formateur
// peut désormais empiler plusieurs questionnaires (un bloc par poste sélectionné, voir
// evaluationEngine.enregistrerEvaluation, payload `blocs`) sous un même verdict —
// `evaluations.poste_code` (migration 038) ne porte qu'une seule valeur, incompatible avec cet
// empilement. Table de jonction plutôt qu'une colonne tableau : reste joignable/filtrable comme
// le reste du module évaluation (evaluation_reponses, questions_evaluation...), utile pour le
// futur tableau de bord par poste (CLAUDE.md).
//
// evaluations.poste_code n'est volontairement pas supprimé ici (migration 041, séparée, une fois
// le nouveau chemin de lecture/écriture vérifié) — cette migration ajoute la table et backfille
// les données existantes sans rien casser côté colonne historique.
exports.up = (knex) =>
  knex.schema
    .createTable('evaluations_postes', (table) => {
      table.increments('id').primary();
      table.integer('evaluation_id').notNullable().references('id').inTable('evaluations').onDelete('CASCADE');
      table.string('poste_code').notNullable();
      table.unique(['evaluation_id', 'poste_code']);
    })
    .then(() =>
      // poste_code NULL = repli générique sur l'ancienne colonne : aucune ligne à créer (l'absence
      // de ligne porte la même sémantique "générique" que la colonne aujourd'hui), voir
      // evaluationRepository.trouverQuestionnairePourPoste.
      knex.raw(`
        INSERT INTO evaluations_postes (evaluation_id, poste_code)
        SELECT id, poste_code FROM evaluations WHERE poste_code IS NOT NULL
      `),
    );

exports.down = (knex) => knex.schema.dropTableIfExists('evaluations_postes');
