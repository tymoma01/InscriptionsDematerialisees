// Précision libre du motif de désistement d'un rendez-vous, obligatoire (règle applicative, voir
// core/rendezvous/rendezvousService.js) quand le motif choisi est « Autre motif ». Nullable : les
// autres motifs, et tous les rendez-vous existants, n'en ont pas.
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.string('motif_precision', 200).nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('motif_precision');
  });
