exports.up = (knex) =>
  knex.schema.createTable('candidats', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('nom').notNullable();
    table.string('prenom').notNullable();
    table.date('date_naissance').notNullable();
    table.specificType('nir', 'bytea').notNullable();
    table.specificType('nir_iv', 'bytea').notNullable();
    table.string('situation_familiale').notNullable();
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('candidats');
