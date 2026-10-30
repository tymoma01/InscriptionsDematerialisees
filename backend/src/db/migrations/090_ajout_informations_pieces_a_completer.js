// « Renseigner plus tard » (core/dossier/informationsPiecesService.js) : l'accueil reporte la
// confirmation de la pièce d'identité ou du RIB. Un indicateur par pièce, faux par défaut : les
// candidats existants gardent l'état qu'ils avaient (confirmé si les informations sont présentes,
// non confirmé sinon).
exports.up = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.boolean('piece_identite_a_completer').notNullable().defaultTo(false);
    table.boolean('rib_a_completer').notNullable().defaultTo(false);
  });

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.dropColumn('piece_identite_a_completer');
    table.dropColumn('rib_a_completer');
  });
