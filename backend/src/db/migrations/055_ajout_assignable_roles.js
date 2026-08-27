// Audit du rôle Recruteur (2026-08-27), étape 4 révisée (Option C, décision utilisateur) : ne
// supprime PAS la ligne `roles` du rôle Recruteur — la FK utilisateurs.role_id (NOT NULL, ON
// DELETE NO ACTION) et les 8 comptes qui le portent encore rendraient une suppression physique
// impossible sans soit réassigner leur role_id (rejeté : fausserait rétroactivement l'affichage
// du rôle sur les fiches dossiers historiques — voir "Planifié par ... (Rôle)",
// rendezvousRepository.listerRendezvousParDossier), soit rendre role_id nullable (rejeté :
// utilisateurRepository.js utilise un INNER JOIN roles à 4 endroits, un role_id NULL ferait
// disparaître ces comptes de toutes les listes admin, à l'opposé du but "garder une trace
// nominative").
//
// `assignable` (booléen, défaut true) : marque un rôle comme proposable ou non à la création/
// modification d'un compte, indépendamment de son usage historique — un rôle non assignable reste
// pleinement valide pour les comptes qui le portent déjà (aucun changement pour eux), simplement
// plus jamais attribuable à un NOUVEAU compte ni resélectionnable dans le formulaire d'édition
// (voir utilisateurRepository.listerRolesAssignables et utilisateurService.creerUtilisateur/
// mettreAJourUtilisateur, revalidés après cette migration).
exports.up = (knex) =>
  knex.schema.alterTable('roles', (table) => {
    table.boolean('assignable').notNullable().defaultTo(true);
  });

exports.down = (knex) =>
  knex.schema.alterTable('roles', (table) => {
    table.dropColumn('assignable');
  });
