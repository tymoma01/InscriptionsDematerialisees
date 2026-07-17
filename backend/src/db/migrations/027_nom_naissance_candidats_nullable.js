// Le nom de naissance n'est plus obligatoire dans le formulaire d'inscription (bloc infos_perso).
exports.up = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.string('nom_naissance').nullable().alter();
  });

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.string('nom_naissance').notNullable().alter();
  });
