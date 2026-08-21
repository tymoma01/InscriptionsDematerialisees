// Ajoute `neutralise_rendezvous_actifs` sur `statuts` — indique, par statut d'ARRIVÉE d'une
// transition, si workflowEngine.appliquerTransition doit neutraliser (statut -> 'remplace', jamais
// supprimé) tout rendez-vous encore 'prevu'/'confirme' du dossier une fois la transition écrite
// (audit 2026-08-21, dossier #37 : un admin avait fait transiter le dossier vers "invalide" pendant
// qu'un rendez-vous restait 'prevu' en base, resté orphelin indéfiniment — sans impact fonctionnel
// grâce au verrouillage front STATUTS_DOSSIER_RENDEZVOUS_CLOS, mais incohérent en données/
// historique). Champ de CONFIGURATION (comme est_initial/est_final, voir migration 005) plutôt
// qu'une liste de codes en dur dans workflowEngine.js : ce fichier documente explicitement ne
// connaître "aucun statut ni transition nommés en dur" (voir son commentaire d'en-tête, Modularité
// CLAUDE.md) — un statut "clos" pour cet usage varie par entité (ex. Adaptel n'a aujourd'hui aucun
// statut de ce type), jamais une liste figée valable pour toute entité.
// boolean NOT NULL DEFAULT false : un statut existant (migré avant cette colonne) reste par défaut
// sans neutralisation automatique, comportement identique à avant cette migration tant que
// scripts/seedStatuts.js n'a pas été rejoué avec `neutraliseRendezvousActifs: true` positionné
// explicitement dans workflow.config.json pour les statuts concernés.
exports.up = (knex) =>
  knex.schema.alterTable('statuts', (table) => {
    table.boolean('neutralise_rendezvous_actifs').notNullable().defaultTo(false);
  });

exports.down = (knex) =>
  knex.schema.alterTable('statuts', (table) => {
    table.dropColumn('neutralise_rendezvous_actifs');
  });
