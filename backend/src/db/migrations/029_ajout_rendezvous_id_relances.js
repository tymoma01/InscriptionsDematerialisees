// Ajoute une FK optionnelle vers `rendezvous` sur `relances` (table déjà existante, migration
// 017) — nécessaire pour le rappel automatique de créneau (CLAUDE.md, besoin Accueil/Coordination
// "confirmation de présence à un créneau avant le jour J") : sans ce lien, il est impossible de
// savoir si un rappel a déjà été envoyé pour UN rendez-vous précis d'un dossier qui peut en avoir
// plusieurs au fil des reprogrammations (voir docs/architecture-technique.md §3.3, "chaque envoi
// est journalisé dans relances"). Nullable : une relance manuelle (ex. relance pour pièces
// manquantes) n'est rattachée à aucun rendez-vous.
exports.up = (knex) =>
  knex.schema.alterTable('relances', (table) => {
    table.integer('rendezvous_id').nullable().references('id').inTable('rendezvous');
  });

exports.down = (knex) =>
  knex.schema.alterTable('relances', (table) => {
    table.dropColumn('rendezvous_id');
  });
