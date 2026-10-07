// Mémorisation du classement sans suite d'une demande DPAE : rôle qui l'a classée et statut qu'elle avait
// juste avant (colonnes nulles hors classement). Elles servent à la réactivation par l'Admin, qui renvoie la
// demande chez le rôle qui l'avait classée.
//
// Reprise des demandes DÉJÀ classées, à partir de journal_audit en LECTURE seule : rôle de l'auteur de la
// dernière entrée « demande_dpae_classement_sans_suite », statut d'avant reconstitué en rejouant les actions
// tracées avant le classement (à défaut d'action, statut de création selon le rôle du demandeur). Une demande
// qu'on ne peut pas reconstituer garde des colonnes nulles et est listée dans les journaux de la migration.

const ACTION_CLASSEMENT = 'demande_dpae_classement_sans_suite';
const ROLE_SOUMIS_AU_PLANNING = 'inspecteur_hotellerie';
// Action tracée -> statut dans lequel elle laisse la demande (la modification et les notes n'en changent pas).
const STATUT_APRES_ACTION = {
  demande_dpae_transmission_rh: 'envoyee',
  demande_dpae_retransmission_rh: 'envoyee',
  demande_dpae_renvoi_inspecteur: 'renvoyee_inspecteur',
  demande_dpae_envoi_planning: 'a_valider_planning',
  demande_dpae_mise_en_attente: 'en_attente',
};

// Statut d'une demande juste avant son classement. `actionsAvantClassement` : actions tracées avant le
// classement, de la plus ancienne à la plus récente. Fonction pure.
function reconstituerStatutAvantClassement({ roleDemandeur, actionsAvantClassement }) {
  const transitions = actionsAvantClassement.filter((action) => STATUT_APRES_ACTION[action]);
  if (transitions.length > 0) return STATUT_APRES_ACTION[transitions.at(-1)];
  if (!roleDemandeur) return null;
  return roleDemandeur === ROLE_SOUMIS_AU_PLANNING ? 'a_valider_planning' : 'envoyee';
}

exports.reconstituerStatutAvantClassement = reconstituerStatutAvantClassement;

exports.up = async (knex) => {
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.text('classee_par_role').nullable();
    table.text('statut_avant_classement').nullable();
  });

  const classees = await knex('demandes_dpae as d')
    .leftJoin('utilisateurs as u', 'u.id', 'd.demandeur_id')
    .leftJoin('roles as r', 'r.id', 'u.role_id')
    .where('d.statut', 'classee_sans_suite')
    .select('d.id', 'r.code as role_demandeur');
  const nonReconstituees = [];
  // Quelques demandes au plus : lecture du journal d'audit en séquence.
  for (const demande of classees) {
    const entrees = await knex('journal_audit as a')
      .leftJoin('utilisateurs as u', 'u.id', 'a.utilisateur_id')
      .leftJoin('roles as r', 'r.id', 'u.role_id')
      .where({ 'a.table_cible': 'demandes_dpae', 'a.cible_id': demande.id })
      .orderBy([{ column: 'a.date_action', order: 'asc' }, { column: 'a.id', order: 'asc' }])
      .select('a.action', 'r.code as role');
    const indexClassement = entrees.map((entree) => entree.action).lastIndexOf(ACTION_CLASSEMENT);
    if (indexClassement === -1 || !entrees[indexClassement].role) {
      nonReconstituees.push(demande.id);
      continue;
    }
    const statutAvant = reconstituerStatutAvantClassement({
      roleDemandeur: demande.role_demandeur,
      actionsAvantClassement: entrees.slice(0, indexClassement).map((entree) => entree.action),
    });
    await knex('demandes_dpae').where({ id: demande.id }).update({ classee_par_role: entrees[indexClassement].role, statut_avant_classement: statutAvant });
  }
  console.log(`Migration 084 : ${classees.length - nonReconstituees.length}/${classees.length} demande(s) classée(s) reconstituée(s)${nonReconstituees.length > 0 ? ` ; NON reconstituées (demandes) : ${nonReconstituees.join(', ')}` : ''}.`);
};

exports.down = (knex) =>
  knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('classee_par_role');
    table.dropColumn('statut_avant_classement');
  });
