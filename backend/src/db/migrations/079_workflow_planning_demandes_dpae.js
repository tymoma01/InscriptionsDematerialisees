// Passage des demandes DPAE des inspecteurs par le Planning : deux statuts supplémentaires
// (« À valider par le Planning », « Renvoyée à l'inspecteur »), la date d'envoi à la RH (point de
// départ des délais de traitement RH) et le dernier motif de renvoi. Les codes de la contrainte sont
// recopiés volontairement : une migration reste figée, elle ne dépend pas du code courant.
const NOM_CONTRAINTE = 'demandes_dpae_statut_check';
const STATUTS_ANCIENS = ['envoyee', 'en_attente', 'validee', 'rejetee'];
const STATUTS = ['a_valider_planning', 'renvoyee_inspecteur', ...STATUTS_ANCIENS];

const liste = (statuts) => statuts.map((statut) => `'${statut}'`).join(', ');

// Littéraux inlinés : PostgreSQL n'accepte pas de paramètres liés dans un ALTER TABLE.
exports.up = async (knex) => {
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.timestamp('date_envoi_rh', { useTz: true }).nullable();
    table.text('motif_renvoi').nullable();
  });
  // Jusqu'ici une demande partait à la RH dès sa création.
  await knex('demandes_dpae').update({ date_envoi_rh: knex.ref('date_creation') });
  await knex.raw(`ALTER TABLE demandes_dpae DROP CONSTRAINT IF EXISTS ${NOM_CONTRAINTE}`);
  await knex.raw(`ALTER TABLE demandes_dpae ADD CONSTRAINT ${NOM_CONTRAINTE} CHECK (statut IN (${liste(STATUTS)}))`);
};

// Les demandes encore chez le Planning sont ramenées à « À traiter » pour que l'ancienne contrainte
// reste satisfaite.
exports.down = async (knex) => {
  await knex.raw(`ALTER TABLE demandes_dpae DROP CONSTRAINT IF EXISTS ${NOM_CONTRAINTE}`);
  await knex('demandes_dpae').whereNotIn('statut', STATUTS_ANCIENS).update({ statut: 'envoyee' });
  await knex.raw(`ALTER TABLE demandes_dpae ADD CONSTRAINT ${NOM_CONTRAINTE} CHECK (statut IN (${liste(STATUTS_ANCIENS)}))`);
  await knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('motif_renvoi');
    table.dropColumn('date_envoi_rh');
  });
};
