exports.up = (knex) =>
  knex.schema.createTable('evaluations', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.integer('rendezvous_id').notNullable().references('id').inTable('rendezvous');
    table.integer('formateur_id').notNullable().references('id').inTable('utilisateurs');
    table.string('resultat_global').notNullable();
    table.text('commentaire').notNullable();
    table.timestamp('date_evaluation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('evaluations');
