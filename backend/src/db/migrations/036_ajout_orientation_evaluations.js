// Simplification du parcours (workflow v3, décision responsable de projet) : un verdict positif
// se décline maintenant en deux orientations (envoi en formation / prêt à l'embauche direct),
// distinctes du verdict lui-même (resultat_global reste valide/invalide) — voir
// evaluationEngine.js. Nullable : uniquement renseigné quand resultat_global = 'valide'.
exports.up = (knex) =>
  knex.schema.alterTable('evaluations', (table) => {
    table.string('orientation');
  });

exports.down = (knex) =>
  knex.schema.alterTable('evaluations', (table) => {
    table.dropColumn('orientation');
  });
