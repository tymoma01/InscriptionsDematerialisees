// Ajoute `motif_id` sur `rendezvous` (table déjà existante, migration 018) — porte le motif de
// désistement (CLAUDE.md, besoin Accueil/Coordination : "motif de désistement enregistré
// systématiquement, pour objectiver le phénomène et nourrir le futur tableau de bord"), pour un
// rendez-vous passant à 'absent' (non présenté) ou 'annule' (désistement annoncé à l'avance).
// Nullable au niveau base (un rendez-vous 'prevu'/'confirme' n'a pas de motif) : le caractère
// systématique n'est pas une contrainte SQL mais une règle applicative (voir
// core/rendezvous/rendezvousService.js) — même choix que `motif_requis` sur `transitions_statut`
// (migration 005), qui est lui aussi une contrainte portée par le moteur, pas par le schéma.
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.integer('motif_id').nullable().references('id').inTable('motifs');
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('motif_id');
  });
