exports.up = (knex) =>
  knex.schema.createTable('statuts', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('code').notNullable();
    table.string('libelle').notNullable();
    table.integer('ordre').notNullable();
    table.boolean('est_initial').notNullable().defaultTo(false);
    table.boolean('est_final').notNullable().defaultTo(false);
    table.unique(['entite_id', 'code']);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('statuts');
