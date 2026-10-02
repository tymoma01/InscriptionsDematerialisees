// Rôles — par migration pour exister en production dès le déploiement.
//
// 1. Libellés AFFICHÉS seulement (roles.libelle : Comptes utilisateurs, rôle de l'auteur d'une note…) :
//    'formateur' -> « Formateur Hôtellerie », 'inspecteur' -> « Formateur Tertiaire ». Les CODES ne
//    changent pas (utilisateurs, transition_roles, routes, groupes de rôles intacts).
// 2. Nouveau rôle 'inspecteur_hotellerie' (« Inspecteur Hôtellerie »), assignable par l'Admin dans
//    Comptes utilisateurs. AUCUNE ligne transition_roles : ce rôle ne déclenche aucune transition.
//    Droits : voir core/auth/rbac.js et core/auth/perimetreDossiers.js.
//
// Idempotente : rôle inséré seulement s'il n'existe pas ; libellés écrits par code.
const LIBELLES = {
  formateur: { nouveau: 'Formateur Hôtellerie', ancien: 'Formateur' },
  inspecteur: { nouveau: 'Formateur Tertiaire', ancien: 'Inspecteur' },
};
const NOUVEAU_ROLE = { code: 'inspecteur_hotellerie', libelle: 'Inspecteur Hôtellerie', assignable: true };

exports.up = async (knex) => {
  for (const [code, { nouveau }] of Object.entries(LIBELLES)) {
     
    await knex('roles').where({ code }).update({ libelle: nouveau });
  }
  const existant = await knex('roles').where({ code: NOUVEAU_ROLE.code }).first('id');
  if (!existant) await knex('roles').insert(NOUVEAU_ROLE);
};

exports.down = async (knex) => {
  for (const [code, { ancien }] of Object.entries(LIBELLES)) {
     
    await knex('roles').where({ code }).update({ libelle: ancien });
  }
  // Retrait du rôle seulement s'il n'est porté par aucun compte (sinon : clé étrangère utilisateurs).
  const role = await knex('roles').where({ code: NOUVEAU_ROLE.code }).first('id');
  if (role && !(await knex('utilisateurs').where({ role_id: role.id }).first('id'))) {
    await knex('roles').where({ id: role.id }).del();
  }
};
