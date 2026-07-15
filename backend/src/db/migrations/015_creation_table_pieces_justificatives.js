exports.up = (knex) =>
  knex.schema.createTable('pieces_justificatives', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.integer('type_piece_id').notNullable().references('id').inTable('types_pieces');
    table.string('reference_stockage').notNullable();
    table.string('nom_fichier').notNullable();
    table.integer('uploaded_by').notNullable().references('id').inTable('utilisateurs');
    table.timestamp('date_upload', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('pieces_justificatives');
