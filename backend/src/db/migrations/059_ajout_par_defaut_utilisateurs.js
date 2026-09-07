// Formateur/inspecteur par défaut selon le secteur du dossier (Bureau/Hôtel) — audit planification
// des tests, 2026-09-07, demande utilisateur : même mécanisme que `lieux.par_defaut` (migration
// 054) pour ModalePlanificationTest.jsx/ModaleReplanificationGroupee.jsx, appliqué ici à
// `utilisateurs` plutôt qu'à `lieux`.
//
// Pas de colonne `secteur` séparée sur `utilisateurs`, contrairement à `lieux` : le rôle porté par
// un compte détermine déjà son secteur de façon univoque dans ce moteur (ROLES.INSPECTEUR = postes
// bureau, ROLES.FORMATEUR = postes hôtel, imposé aussi côté back — voir rendezvousService.js,
// ModalePlanificationTest.jsx `groupeImposeParSecteur`) : ajouter un second champ redondant avec
// `role_id` irait à l'encontre de la donnée qui fait déjà foi. L'unicité du défaut est donc posée
// par (entite_id, role_id), pas par un secteur explicite.
//
// `par_defaut` : booléen, défaut false — un seul utilisateur par_defaut=true par (entite_id,
// role_id) à la fois, contrainte posée ICI en base (index unique partiel, même principe défense en
// profondeur que idx_lieux_un_defaut_par_secteur, migration 054) en plus de la bascule applicative
// (utilisateurRepository.definirUtilisateurParDefaut, transaction qui désactive l'ancien défaut
// avant d'activer le nouveau).
exports.up = async (knex) => {
  await knex.schema.alterTable('utilisateurs', (table) => {
    table.boolean('par_defaut').notNullable().defaultTo(false);
  });
  await knex.raw(
    'CREATE UNIQUE INDEX idx_utilisateurs_un_defaut_par_role ON utilisateurs (entite_id, role_id) WHERE par_defaut = true',
  );
};

exports.down = async (knex) => {
  await knex.raw('DROP INDEX IF EXISTS idx_utilisateurs_un_defaut_par_role');
  await knex.schema.alterTable('utilisateurs', (table) => {
    table.dropColumn('par_defaut');
  });
};
