exports.up = (knex) =>
  knex.schema.createTable('dossier_donnees_formulaire', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.string('bloc_code').notNullable().references('code').inTable('blocs_disponibles');
    table.jsonb('donnees').notNullable().defaultTo('{}');
    table.timestamp('date_maj', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(['dossier_id', 'bloc_code']);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('dossier_donnees_formulaire');
