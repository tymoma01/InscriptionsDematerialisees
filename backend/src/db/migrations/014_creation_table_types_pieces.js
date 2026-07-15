exports.up = (knex) =>
  knex.schema.createTable('types_pieces', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('code').notNullable();
    table.string('libelle').notNullable();
    table.boolean('obligatoire').notNullable().defaultTo(true);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('types_pieces');
