// Question « Êtes-vous étudiant ? » — réponse portée par le dossier.
// Booléen NULLABLE : les dossiers existants ne sont PAS remplis (null = pas de réponse, affiché « — ») ;
// toute NOUVELLE inscription doit fournir la réponse (contrôle côté serveur, dossierService
// donneesInscriptionSchema, refus explicite si absente).
exports.up = (knex) =>
  knex.schema.alterTable('dossiers', (table) => {
    table.boolean('est_etudiant').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('dossiers', (table) => {
    table.dropColumn('est_etudiant');
  });
