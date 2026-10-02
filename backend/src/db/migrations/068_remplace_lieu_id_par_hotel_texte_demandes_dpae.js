// Correctif : la migration 066 a été appliquée en dev AVANT d'être révisée (demande
// utilisateur : le champ "Hôtel" doit être un texte libre, pas une liste tirée de `lieux` — cette
// table liste les lieux de TEST candidat, une notion distincte de l'hôtel concerné par une demande
// de staffing ; "Entité" > "Autre" doit aussi pouvoir être précisée). Éditer 066 directement
// n'aurait donc plus aucun effet sur une base où elle est déjà marquée comme jouée (`knex_migrations`)
// — d'où cette migration séparée, qui rattrape le même écart que si 066 avait été écrite avec le
// bon schéma dès le départ. Toute base encore vierge de 066 (nouvel environnement) obtient
// directement le bon schéma via 066 elle-même ; celle-ci ne fait donc rien sur une base neuve où
// 066 n'a jamais créé `lieu_id`.
exports.up = async (knex) => {
  const aLieuId = await knex.schema.hasColumn('demandes_dpae', 'lieu_id');
  if (aLieuId) {
    await knex.schema.alterTable('demandes_dpae', (table) => {
      table.dropColumn('lieu_id');
    });
  }

  const aHotel = await knex.schema.hasColumn('demandes_dpae', 'hotel');
  const aDivisionAutre = await knex.schema.hasColumn('demandes_dpae', 'division_autre');
  await knex.schema.alterTable('demandes_dpae', (table) => {
    if (!aHotel) table.string('hotel').nullable();
    if (!aDivisionAutre) table.string('division_autre').nullable();
  });
};

exports.down = (knex) =>
  knex.schema.alterTable('demandes_dpae', (table) => {
    table.dropColumn('hotel');
    table.dropColumn('division_autre');
    table.integer('lieu_id').nullable().references('id').inTable('lieux');
  });
