exports.up = (knex) =>
  knex.schema
    .createTable('chartes', (table) => {
      table.increments('id').primary();
      table.integer('version').notNullable();
      table.text('texte').notNullable();
      table.string('hash').notNullable().unique();
      table.integer('entite_id').unsigned().notNullable()
        .references('id').inTable('entites').onDelete('CASCADE');
      table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.boolean('actif').notNullable().defaultTo(true);
    })
    .then(() =>
      // Une seule charte active à la fois par entité
      knex.raw(`
        CREATE UNIQUE INDEX idx_charte_active_unique
        ON chartes (entite_id)
        WHERE actif = true
      `)
    );

exports.down = (knex) => knex.schema.dropTableIfExists('chartes');