exports.up = (knex) =>
  knex.schema.createTable('criteres_evaluation', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('code').notNullable();
    table.string('libelle').notNullable();
    table.integer('ordre').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('criteres_evaluation');
