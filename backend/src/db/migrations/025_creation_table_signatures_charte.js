exports.up = (knex) =>
  knex.schema.createTable('signatures_charte', (table) => {
    table.increments('id').primary();
    table.integer('candidat_id').unsigned().notNullable()
      .references('id').inTable('candidats').onDelete('CASCADE');
    table.integer('charte_id').unsigned().notNullable()
      .references('id').inTable('chartes').onDelete('RESTRICT');
    table.binary('signature_image').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('signatures_charte');