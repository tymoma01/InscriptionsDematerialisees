// Téléphone du compte utilisateur (formateur/inspecteur en premier lieu) — nécessaire pour
// envoyer par SMS la convocation de test au formateur/inspecteur assigné, en plus de l'email déjà
// disponible (migration 003). Nullable : les comptes existants n'en ont pas, et seul le canal SMS
// en a besoin (l'email reste exploitable sans lui) — même choix que `motif_id`/`commentaire`
// (migrations 031/034), contrainte applicative (voir utilisateurService.js) plutôt que SQL.
exports.up = (knex) =>
  knex.schema.alterTable('utilisateurs', (table) => {
    table.string('telephone').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('utilisateurs', (table) => {
    table.dropColumn('telephone');
  });
