exports.up = (knex) =>
  knex.schema.createTable('entites', (table) => {
    table.increments('id').primary();
    table.string('code').notNullable().unique();
    table.string('nom').notNullable();
    table.string('connecteur_stockage').notNullable();
    table.boolean('sms_actif').notNullable().defaultTo(false);
    table.boolean('smartof_actif').notNullable().defaultTo(false);
    table.integer('duree_conservation_mois').notNullable().defaultTo(12);
    table.boolean('actif').notNullable().defaultTo(true);
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('entites');
