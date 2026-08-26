// Généralise criteres_evaluation/evaluation_resultats (migrations 019/021) pour supporter un
// questionnaire d'évaluation différent selon le poste réellement recherché par le candidat, pas
// une grille unique pour tous (voir Modularité, CLAUDE.md — chaque poste peut avoir ses propres
// questions). N'efface ni ne touche les tables existantes : les 6 évaluations déjà en base sont
// migrées séparément (voir scripts/migrerEvaluationsVersQuestionnaires.js), criteres_evaluation/
// evaluation_resultats restent en base pour l'historique.
//
// poste_code nullable sur questionnaires_evaluation : NULL = questionnaire générique de repli,
// utilisé quand le poste du dossier ne correspond à aucun questionnaire dédié (candidat sur un
// poste bureau, ou un futur poste hôtel pas encore configuré) — permet d'ajouter des postes plus
// tard sans jamais faire échouer une évaluation.
exports.up = (knex) =>
  knex.schema
    .createTable('questionnaires_evaluation', (table) => {
      table.increments('id').primary();
      table.integer('entite_id').notNullable().references('id').inTable('entites');
      table.string('poste_code');
      table.unique(['entite_id', 'poste_code']);
    })
    .createTable('questions_evaluation', (table) => {
      table.increments('id').primary();
      table
        .integer('questionnaire_id')
        .notNullable()
        .references('id')
        .inTable('questionnaires_evaluation')
        .onDelete('CASCADE');
      table.string('code').notNullable();
      table.string('libelle').notNullable();
      // 'grille_qcu' (une ligne par item, choix unique parmi 3 valeurs fixes — voir
      // evaluationEngine.js, ACQUIS_AUTORISEES), 'choix_multiple' (items = cases indépendantes),
      // 'texte_libre' (pas d'item, une seule réponse texte, voir question_items_evaluation),
      // 'oui_non' (audit 2026-08-26 : pas d'item non plus, une seule réponse oui/non — voir
      // evaluationEngine.js, OUI_NON_AUTORISEES). Simple valeur de colonne, jamais de contrainte
      // CHECK ici : ajouter un type de question ne nécessite jamais de migration, seulement du
      // code applicatif (voir Modularité, CLAUDE.md).
      table.string('type_question').notNullable();
      table.boolean('obligatoire').notNullable().defaultTo(false);
      table.integer('ordre').notNullable();
      table.unique(['questionnaire_id', 'code']);
    })
    .createTable('question_items_evaluation', (table) => {
      table.increments('id').primary();
      table.integer('question_id').notNullable().references('id').inTable('questions_evaluation').onDelete('CASCADE');
      table.string('code').notNullable();
      table.string('libelle').notNullable();
      table.integer('ordre').notNullable();
      table.unique(['question_id', 'code']);
    })
    .createTable('evaluation_reponses', (table) => {
      table.increments('id').primary();
      table.integer('evaluation_id').notNullable().references('id').inTable('evaluations').onDelete('CASCADE');
      table.integer('question_id').notNullable().references('id').inTable('questions_evaluation');
      // Nullable : sans objet pour une question 'texte_libre' (une seule réponse par question,
      // pas par item).
      table.integer('question_item_id').references('id').inTable('question_items_evaluation');
      table.text('valeur').notNullable();
    });

exports.down = (knex) =>
  knex.schema
    .dropTableIfExists('evaluation_reponses')
    .then(() => knex.schema.dropTableIfExists('question_items_evaluation'))
    .then(() => knex.schema.dropTableIfExists('questions_evaluation'))
    .then(() => knex.schema.dropTableIfExists('questionnaires_evaluation'));
