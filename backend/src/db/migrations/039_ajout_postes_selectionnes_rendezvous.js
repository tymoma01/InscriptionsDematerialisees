// Phase 1 (informatif) : le(s) poste(s) pour lesquels l'agent Accueil planifie CE test précis,
// quand plusieurs postes sont déclarés sur le dossier (posteBureau/posteHotel, voir
// dossier_donnees_formulaire) — sert uniquement à orienter le formateur sur ce qu'il doit tester
// (voir evaluationEngine.resoudrePosteCode). N'introduit aucun verdict par poste ni RDV multiples :
// le dossier garde un verdict unique (workflow v4, test_planifie -> issue finale).
// notNullable + defaultTo('[]') plutôt que nullable : évite un ?? [] à chaque lecture (même choix
// que dossier_donnees_formulaire.donnees, migration 013). Tableau plat de codes (pas deux colonnes
// bureau/hotel séparées) : posteBureau et posteHotel ne sont jamais peuplés simultanément sur un
// même dossier (typePoste XOR, voir dossierService.js), les codes des deux univers sont déjà
// disjoints.
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.jsonb('postes_selectionnes').notNullable().defaultTo('[]');
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('postes_selectionnes');
  });
