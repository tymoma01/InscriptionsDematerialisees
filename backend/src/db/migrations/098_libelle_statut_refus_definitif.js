// Le statut de code « blackliste » est affiché « Refus définitif » : seul le libellé de la ligne de
// configuration change, le code technique et les données des dossiers restent intacts.
const CODE_STATUT = 'blackliste';

exports.up = async (knex) => {
  await knex('statuts').where({ code: CODE_STATUT }).update({ libelle: 'Refus définitif' });
};

exports.down = async (knex) => {
  await knex('statuts').where({ code: CODE_STATUT }).update({ libelle: 'Blacklisté' });
};
