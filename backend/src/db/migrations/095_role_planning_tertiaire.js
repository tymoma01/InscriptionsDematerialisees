// Planning par entité : « Planning » devient « Planning Hôtellerie » (libellé seulement, le code
// 'planning' ne change pas) et le rôle « Planning Tertiaire » (code 'planning_tertiaire') est créé, assignable
// depuis Comptes utilisateurs. Aucun compte existant n'est modifié.
//
// Le Planning Tertiaire reçoit les mêmes transitions de workflow que le Planning (copie de ses lignes
// transition_roles) et la configuration DPAE du Tertiaire (postes proposés ; échelons à compléter plus
// tard dans `entites.dpae_config.tertiaire.echelons_par_poste`, vides pour l'instant : la section « Échelon »
// du formulaire est alors masquée).
//
// Idempotente : rôle et lignes insérés seulement s'ils n'existent pas.
const NOUVEAU_ROLE = { code: 'planning_tertiaire', libelle: 'Planning Tertiaire', assignable: true };
const CONFIG_TERTIAIRE = {
  postes: ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autre'],
  echelons_par_poste: {},
  postes_tous_echelons: [],
};

exports.up = async (knex) => {
  await knex('roles').where({ code: 'planning' }).update({ libelle: 'Planning Hôtellerie' });

  let role = await knex('roles').where({ code: NOUVEAU_ROLE.code }).first('id');
  if (!role) [role] = await knex('roles').insert(NOUVEAU_ROLE).returning('id');

  const planning = await knex('roles').where({ code: 'planning' }).first('id');
  if (planning) {
    const lignes = await knex('transition_roles').where({ role_id: planning.id }).select('transition_id');
    for (const { transition_id: transitionId } of lignes) {
      const existante = await knex('transition_roles').where({ transition_id: transitionId, role_id: role.id }).first('transition_id');
      if (!existante) await knex('transition_roles').insert({ transition_id: transitionId, role_id: role.id });
    }
  }

  await knex.raw(`UPDATE entites SET dpae_config = dpae_config || ?::jsonb WHERE code = 'accecit'`, [JSON.stringify({ tertiaire: CONFIG_TERTIAIRE })]);
};

exports.down = async (knex) => {
  await knex('roles').where({ code: 'planning' }).update({ libelle: 'Planning' });
  await knex.raw(`UPDATE entites SET dpae_config = dpae_config - 'tertiaire' WHERE code = 'accecit'`);
  // Retrait du rôle seulement s'il n'est porté par aucun compte (sinon : clé étrangère utilisateurs).
  const role = await knex('roles').where({ code: NOUVEAU_ROLE.code }).first('id');
  if (role && !(await knex('utilisateurs').where({ role_id: role.id }).first('id'))) {
    await knex('transition_roles').where({ role_id: role.id }).del();
    await knex('roles').where({ id: role.id }).del();
  }
};
