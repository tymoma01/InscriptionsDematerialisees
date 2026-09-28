// Notifications internes génériques (module Demandes DPAE, 2026-09-28) — système volontairement
// distinct de notificationFactory.js (SMS/AllMySMS, email/Microsoft Graph, adressé au candidat) :
// celui-ci ne notifie jamais un candidat, uniquement un agent interne (`utilisateurs`), et ne
// déclenche aucun envoi externe (décision actée : pas d'email pour la DPAE, suivi en in-app
// uniquement). `table_cible`/`cible_id` reprennent la même convention que `journal_audit`
// (migration 023) pour rester réutilisable par un futur type de notification que la DPAE, sans
// nouvelle table.
exports.up = (knex) =>
  knex.schema.createTable('notifications', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.integer('utilisateur_id').notNullable().references('id').inTable('utilisateurs');

    table.string('type').notNullable();
    table.string('table_cible').notNullable();
    table.integer('cible_id').notNullable();
    table.text('message').notNullable();
    // Chemin front (ex. "/rh/dpae/12"), jamais une URL absolue — même esprit que le reste du
    // projet, aucune donnée de routage propre à un environnement stockée en base.
    table.string('lien').nullable();

    table.boolean('lue').notNullable().defaultTo(false);
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('date_lecture', { useTz: true }).nullable();

    // Requête la plus fréquente : compteur/liste des non-lues d'un utilisateur (cloche,
    // NotificationsCloche.jsx) — voir notificationRepository.js.
    table.index(['utilisateur_id', 'lue'], 'notifications_utilisateur_lue_idx');
  });

exports.down = (knex) => knex.schema.dropTableIfExists('notifications');
