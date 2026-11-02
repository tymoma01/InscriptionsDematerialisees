// Statut « retrouve » : salarié déjà employé (ou avenant) dont l'id a été retrouvé dans Pégase à la
// validation de la demande, sans rien y écrire (voir integrations/pegase/pegaseSalarieService.js).
exports.up = async (knex) => {
  await knex.raw('ALTER TABLE pegase_salaries DROP CONSTRAINT pegase_salaries_statut_check');
  await knex.raw("ALTER TABLE pegase_salaries ADD CONSTRAINT pegase_salaries_statut_check CHECK (statut IN ('cree', 'doublon', 'retrouve', 'erreur'))");
};

exports.down = async (knex) => {
  await knex('pegase_salaries').where({ statut: 'retrouve' }).del();
  await knex.raw('ALTER TABLE pegase_salaries DROP CONSTRAINT pegase_salaries_statut_check');
  await knex.raw("ALTER TABLE pegase_salaries ADD CONSTRAINT pegase_salaries_statut_check CHECK (statut IN ('cree', 'doublon', 'erreur'))");
};
