exports.up = (knex) =>
  knex.schema.createTable('consentements', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.string('type_consentement').notNullable();
    table.boolean('accepte').notNullable();
    table.string('signature_reference').notNullable();
    table.timestamp('date_consentement', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('consentements');
