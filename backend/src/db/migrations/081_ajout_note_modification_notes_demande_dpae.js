// Note saisie dans le formulaire de modification d'une demande DPAE : une note ordinaire de la
// demande, repérée par ce drapeau pour être affichée « Note de modification » dans le bloc des notes.
exports.up = (knex) =>
  knex.schema.alterTable('notes_demande_dpae', (table) => {
    table.boolean('est_note_modification').notNullable().defaultTo(false);
  });

exports.down = (knex) =>
  knex.schema.alterTable('notes_demande_dpae', (table) => {
    table.dropColumn('est_note_modification');
  });
