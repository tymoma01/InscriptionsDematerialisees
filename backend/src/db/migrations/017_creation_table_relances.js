exports.up = (knex) =>
  knex.schema.createTable('relances', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.string('canal').notNullable();
    table.integer('utilisateur_id').notNullable().references('id').inTable('utilisateurs');
    table.timestamp('date_envoi', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('resultat').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('relances');
