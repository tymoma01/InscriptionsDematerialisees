exports.up = (knex) =>
  knex.schema.createTable('evaluation_resultats', (table) => {
    table.increments('id').primary();
    table.integer('evaluation_id').notNullable().references('id').inTable('evaluations');
    table.integer('critere_id').notNullable().references('id').inTable('criteres_evaluation');
    table.string('valeur').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('evaluation_resultats');
