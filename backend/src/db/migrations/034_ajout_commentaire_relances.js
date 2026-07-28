// Commentaire libre optionnel sur une relance (voir core/dossier/relanceRepository.js) — note de
// l'agent en plus du canal/résultat déjà en place (ex. "candidat injoignable, rappeler après
// 18h"), jamais obligatoire : colonne nullable, pas de defaultTo.
exports.up = (knex) =>
  knex.schema.alterTable('relances', (table) => {
    table.text('commentaire');
  });

exports.down = (knex) =>
  knex.schema.alterTable('relances', (table) => {
    table.dropColumn('commentaire');
  });
