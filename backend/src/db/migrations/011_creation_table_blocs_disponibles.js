exports.up = (knex) =>
  knex.schema.createTable('blocs_disponibles', (table) => {
    table.increments('id').primary();
    table.string('code').notNullable().unique();
    table.string('libelle').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('blocs_disponibles');
