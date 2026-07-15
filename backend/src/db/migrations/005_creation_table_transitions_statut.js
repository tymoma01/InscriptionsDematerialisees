exports.up = (knex) =>
  knex.schema.createTable('transitions_statut', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.integer('statut_origine_id').nullable().references('id').inTable('statuts');
    table.integer('statut_destination_id').notNullable().references('id').inTable('statuts');
    table.string('code_action').notNullable();
    table.boolean('motif_requis').notNullable().defaultTo(false);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('transitions_statut');
