exports.up = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.string('nom_naissance').notNullable();
    table.string('lieu_naissance').notNullable();
    table.string('nationalite').notNullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.dropColumn('nom_naissance');
    table.dropColumn('lieu_naissance');
    table.dropColumn('nationalite');
  });
