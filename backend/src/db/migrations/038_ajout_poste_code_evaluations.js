// Trace directement le poste effectivement évalué sur `evaluations` — jusqu'ici retrouvable
// seulement indirectement (jointure evaluation_reponses -> questions_evaluation ->
// questionnaires_evaluation.poste_code, voir migration 037). Utile pour l'historique du dossier
// (CLAUDE.md, traçabilité) et pour un futur reporting sans avoir à reconstruire cette jointure à
// chaque fois — un candidat peut repasser un test plus tard pour un poste différent.
// Nullable : sans objet pour un dossier bureau (repli sur le questionnaire générique, poste_code
// NULL sur questionnaires_evaluation lui-même).
exports.up = (knex) =>
  knex.schema.alterTable('evaluations', (table) => {
    table.string('poste_code');
  });

exports.down = (knex) =>
  knex.schema.alterTable('evaluations', (table) => {
    table.dropColumn('poste_code');
  });
