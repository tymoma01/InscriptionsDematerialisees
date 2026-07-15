exports.up = (knex) =>
  knex.schema.createTable('utilisateurs', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.integer('role_id').notNullable().references('id').inTable('roles');
    table.string('nom').notNullable();
    table.string('prenom').notNullable();
    table.string('email').notNullable().unique();
    table.string('mot_de_passe_hash').notNullable();
    table.boolean('actif').notNullable().defaultTo(true);
    table.timestamp('derniere_connexion', { useTz: true }).nullable();
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('utilisateurs');
