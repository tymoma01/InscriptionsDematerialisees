exports.up = (knex) =>
  knex.schema.createTable('rendezvous', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.string('type_rdv').notNullable();
    table.timestamp('date_heure', { useTz: true }).notNullable();
    table.integer('formateur_id').nullable().references('id').inTable('utilisateurs');
    table.string('statut').notNullable();
  });

exports.down = (knex) => knex.schema.dropTableIfExists('rendezvous');
