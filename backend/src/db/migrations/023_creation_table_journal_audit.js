exports.up = (knex) =>
  knex.schema.createTable('journal_audit', (table) => {
    table.increments('id').primary();
    table.integer('utilisateur_id').nullable().references('id').inTable('utilisateurs');
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('action').notNullable();
    table.string('table_cible').notNullable();
    table.integer('cible_id').notNullable();
    table.jsonb('donnees').notNullable().defaultTo('{}');
    table.timestamp('date_action', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.string('adresse_ip').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('journal_audit');
