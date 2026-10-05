// Colonne `version` des demandes DPAE : verrouillage optimiste. Toute écriture qui change une
// demande (décision RH aujourd'hui, modification plus tard) s'applique par
// UPDATE ... WHERE id = ? AND statut = ? AND version = ? et incrémente `version` : si une autre
// écriture est passée entre la lecture et la décision, aucune ligne n'est modifiée et l'appelant
// reçoit un 409. Les demandes existantes démarrent à 1.
exports.up = (knex) =>
  knex.schema.alterTable('demandes_dpae', (table) => {
    table.integer('version').notNullable().defaultTo(1);
  });

exports.down = (knex) =>
  knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('version');
  });
