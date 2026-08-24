// Rafraîchissement automatique du back-office par polling (audit 2026-08-24) : l'endpoint
// GET /api/dossiers/derniere-modification (dossiers.routes.js) interroge
// MAX(date_action) WHERE entite_id = ? sur journal_audit à chaque appel client (toutes les
// 30-60s, par onglet actif) — sans index, ce scope entité scanne toute la table. Même patron que
// la migration 042 (idx_dossiers_entite_date_creation) : entite_id en tête, scope multi-entités
// systématique sur toute requête de ce module, voir CLAUDE.md Modularité.
exports.up = (knex) =>
  knex.schema.alterTable('journal_audit', (table) => {
    table.index(['entite_id', 'date_action'], 'idx_journal_audit_entite_date_action');
  });

exports.down = (knex) =>
  knex.schema.alterTable('journal_audit', (table) => {
    table.dropIndex(['entite_id', 'date_action'], 'idx_journal_audit_entite_date_action');
  });
