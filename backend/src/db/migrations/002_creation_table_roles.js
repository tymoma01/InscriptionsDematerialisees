exports.up = (knex) =>
  knex.schema.createTable('roles', (table) => {
    table.increments('id').primary();
    table.string('code').notNullable().unique();
    table.string('libelle').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('roles');
