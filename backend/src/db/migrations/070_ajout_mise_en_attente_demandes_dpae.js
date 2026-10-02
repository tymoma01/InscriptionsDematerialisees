// Statut « En attente » des demandes DPAE. La colonne `statut`
// est une simple chaîne sans contrainte en base (migration 066) : la valeur 'en_attente' ne
// demande AUCUNE modification de schéma en elle-même. Cette migration n'ajoute que de quoi
// conserver la DERNIÈRE mise en attente (motif obligatoire, date, auteur), affichée sur la fiche
// tant que la demande reste en attente. L'historique complet des mises en attente est tracé dans
// journal_audit (action 'demande_dpae_mise_en_attente', motif compris), pas ici.
//
// Une mise en attente n'est PAS une décision : `date_traitement` / `traite_par_utilisateur_id`
// restent réservés à la décision finale (validée/rejetée), ce qui garde le délai de traitement du
// tableau de bord mesuré de l'envoi à la décision finale.
exports.up = (knex) =>
  knex.schema.alterTable('demandes_dpae', (table) => {
    table.text('motif_mise_en_attente').nullable();
    table.timestamp('date_mise_en_attente', { useTz: true }).nullable();
    table.integer('mis_en_attente_par_id').nullable().references('id').inTable('utilisateurs');
  });

exports.down = (knex) =>
  knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('mis_en_attente_par_id');
    table.dropColumn('date_mise_en_attente');
    table.dropColumn('motif_mise_en_attente');
  });
