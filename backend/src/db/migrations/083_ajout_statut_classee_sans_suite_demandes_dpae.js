// Nouveau statut final « Classée sans suite » des demandes DPAE : la contrainte CHECK est reprise avec
// tous les statuts. Aucune donnée existante n'est modifiée. Les codes sont recopiés volontairement :
// une migration reste figée, elle ne dépend pas du code courant.
const NOM_CONTRAINTE = 'demandes_dpae_statut_check';
const STATUTS_ANCIENS = ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee'];
const STATUTS = [...STATUTS_ANCIENS, 'classee_sans_suite'];

const liste = (statuts) => statuts.map((statut) => `'${statut}'`).join(', ');

// Littéraux inlinés : PostgreSQL n'accepte pas de paramètres liés dans un ALTER TABLE.
exports.up = async (knex) => {
  await knex.raw(`ALTER TABLE demandes_dpae DROP CONSTRAINT IF EXISTS ${NOM_CONTRAINTE}`);
  await knex.raw(`ALTER TABLE demandes_dpae ADD CONSTRAINT ${NOM_CONTRAINTE} CHECK (statut IN (${liste(STATUTS)}))`);
};

// Les demandes classées sans suite deviennent « Rejetée » (autre statut final) pour que l'ancienne
// contrainte reste satisfaite.
exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE demandes_dpae DROP CONSTRAINT IF EXISTS ${NOM_CONTRAINTE}`);
  await knex('demandes_dpae').where({ statut: 'classee_sans_suite' }).update({ statut: 'rejetee' });
  await knex.raw(`ALTER TABLE demandes_dpae ADD CONSTRAINT ${NOM_CONTRAINTE} CHECK (statut IN (${liste(STATUTS_ANCIENS)}))`);
};
