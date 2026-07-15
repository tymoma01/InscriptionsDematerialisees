exports.up = (knex) =>
  knex.schema.createTable('smartof_sync', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.string('smartof_candidat_id').notNullable();
    table.string('statut_sync').notNullable();
    table.jsonb('payload_envoye').notNullable().defaultTo('{}');
    table.timestamp('date_sync', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('smartof_sync');
