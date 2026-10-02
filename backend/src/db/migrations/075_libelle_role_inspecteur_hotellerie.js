// Libellé AFFICHÉ du rôle 'inspecteur_hotellerie' (2026-10-02, demande utilisateur) :
// « Inspecteur Hôtellerie » -> « Inspecteur » (Comptes utilisateurs, rôle de l'auteur d'une note…).
// Le CODE ne change pas (utilisateurs, routes, groupes de rôles intacts). Pas de collision : le rôle
// 'inspecteur' est affiché « Formateur Tertiaire » depuis la migration 073.
const CODE = 'inspecteur_hotellerie';

exports.up = async (knex) => {
  await knex('roles').where({ code: CODE }).update({ libelle: 'Inspecteur' });
};

exports.down = async (knex) => {
  await knex('roles').where({ code: CODE }).update({ libelle: 'Inspecteur Hôtellerie' });
};
