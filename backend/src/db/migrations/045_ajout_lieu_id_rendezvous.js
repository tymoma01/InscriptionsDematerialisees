// Ajoute `lieu_id` sur `rendezvous` (table déjà existante, migration 018 ; `lieux` créée juste
// avant, migration 044) — même patron exact que `motif_id` (migration 031) : référence vers une
// petite table de vocabulaire plutôt que le texte de l'adresse en clair sur chaque ligne, pour
// qu'ajouter un lieu plus tard (scripts/seedLieux.js) n'implique jamais de retoucher les lignes
// déjà en base. Nullable : un rendez-vous existant ou créé sans lieu précisé retombe sur l'adresse
// par défaut ACCECIT (voir invitationTestService.js, LIEU_TEST_ACCECIT).
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.integer('lieu_id').nullable().references('id').inTable('lieux');
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('lieu_id');
  });
