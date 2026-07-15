exports.up = (knex) =>
  knex.schema.createTable('dossiers', (table) => {
    table.increments('id').primary();
    table.integer('candidat_id').notNullable().references('id').inTable('candidats');
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.integer('statut_id').notNullable().references('id').inTable('statuts');
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('date_maj', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('dossiers');
