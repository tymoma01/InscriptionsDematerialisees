// Échelon d'une demande DPAE, dépendant du poste. La correspondance poste -> échelons est une
// configuration de l'entité (`entites.dpae_config`, jsonb comme smartof_config / pegase_config) ;
// `demandes_dpae.echelon` est nullable : les demandes existantes ne sont pas modifiées.
const CONFIG_ACCECIT = {
  echelons_par_poste: {
    femme_valet_chambre: ['AS'],
    equipier: ['AS', 'ATQS'],
    gouvernant: ['CE1', 'CE2', 'CE3', 'MP1'],
    cafetier: ['AS'],
  },
};

exports.up = async (knex) => {
  await knex.schema.alterTable('entites', (table) => {
    table.jsonb('dpae_config').notNullable().defaultTo('{}');
  });
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.string('echelon').nullable();
  });
  await knex('entites').where({ code: 'accecit' }).update({ dpae_config: JSON.stringify(CONFIG_ACCECIT) });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('echelon');
  });
  await knex.schema.alterTable('entites', (table) => {
    table.dropColumn('dpae_config');
  });
};
