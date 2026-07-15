exports.up = (knex) =>
  knex.schema.createTable('motifs', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('categorie').notNullable();
    table.string('code').notNullable();
    table.string('libelle').notNullable();
    table.boolean('actif').notNullable().defaultTo(true);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('motifs');
