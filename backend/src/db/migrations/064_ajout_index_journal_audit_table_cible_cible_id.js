// Badge "Statut forcé manuellement" (audit 2026-09-22, dossiers #16/#54) —
// rendezvousRepository.listerRendezvousTest et dossierRepository.trouverDossierAvecStatutParId
// interrogent désormais journal_audit via un LEFT JOIN LATERAL filtré sur (table_cible, cible_id)
// et trié par date_action DESC, pour retrouver le DERNIER changement de statut de chaque dossier.
// Sans index dédié, ce filtre scanne intégralement journal_audit à chaque exécution — même
// raisonnement que la migration 052 (idx_journal_audit_entite_date_action, ajoutée pour un autre
// accès fréquent sur cette même table) : trouverDossierAvecStatutParId est appelée sur quasiment
// chaque chargement de la fiche dossier (Validation.jsx), et listerRendezvousTest une fois par
// rendez-vous affiché sur "Suivi des tests" — un scan complet à chaque appel ne passera pas à
// l'échelle une fois journal_audit conséquente. `table_cible` en tête (avant `cible_id`) : ce champ
// n'a qu'une poignée de valeurs distinctes ('dossiers', 'rendezvous', 'historique_statuts'...),
// l'ordre n'a donc pas d'impact réel de sélectivité ici, mais reste cohérent avec la clause WHERE
// telle qu'écrite dans les deux requêtes (table_cible = ? AND cible_id = ?).
exports.up = (knex) =>
  knex.schema.alterTable('journal_audit', (table) => {
    table.index(['table_cible', 'cible_id', 'date_action'], 'idx_journal_audit_table_cible_cible_id_date');
  });

exports.down = (knex) =>
  knex.schema.alterTable('journal_audit', (table) => {
    table.dropIndex(['table_cible', 'cible_id', 'date_action'], 'idx_journal_audit_table_cible_cible_id_date');
  });
