// Liste « Entité » des demandes DPAE : « ACCHOT » devient « Hôtellerie » et « RM » « Tertiaire ». Les
// codes stockés dans `demandes_dpae.division` suivent (aucune contrainte sur cette colonne) ; « autre »
// et les valeurs nulles ne changent pas. Les libellés affichés viennent de formatsDpae (libelleDivision).
const CORRESPONDANCES = [
  ['acchot', 'hotellerie'],
  ['rm', 'tertiaire'],
];

exports.up = async (knex) => {
  for (const [ancien, nouveau] of CORRESPONDANCES) {
    await knex('demandes_dpae').where({ division: ancien }).update({ division: nouveau });
  }
};

exports.down = async (knex) => {
  for (const [ancien, nouveau] of CORRESPONDANCES) {
    await knex('demandes_dpae').where({ division: nouveau }).update({ division: ancien });
  }
};
