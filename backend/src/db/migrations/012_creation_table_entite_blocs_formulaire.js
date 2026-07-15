exports.up = (knex) =>
  knex.schema.createTable('entite_blocs_formulaire', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('bloc_code').notNullable().references('code').inTable('blocs_disponibles');
    table.boolean('actif').notNullable().defaultTo(true);
    table.integer('ordre').notNullable();
    table.jsonb('config').notNullable().defaultTo('{}');
    table.unique(['entite_id', 'bloc_code']);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('entite_blocs_formulaire');
