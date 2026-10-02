// types_pieces devient la SEULE source de la liste des pièces justificatives : le front la lit
// via GET /api/types-pieces au lieu de sa copie statique (typesPiecesConfig.accecit.js, supprimé).
// Ajoute ce qui n'existait que dans cette copie — l'ordre d'affichage et le lien recto -> verso —
// et aligne les libellés ACCECIT sur ceux affichés à la tablette (les fiches dossier affichaient
// jusqu'ici une version plus courte pour certaines pièces). Par migration plutôt que par seed pour
// s'appliquer en production au déploiement.
const ACCECIT = [
  { code: 'photo_identite', ordre: 1, libelle: "Photo d'identité" },
  { code: 'carte_identite', ordre: 2, libelle: "Carte d'identité ou Carte de Séjour", code_verso: 'carte_identite_verso' },
  { code: 'carte_vitale', ordre: 3, libelle: 'Carte Vitale ou Attestation de Sécurité Sociale' },
  { code: 'rib', ordre: 4, libelle: "Relevé d'identité bancaire (RIB)" },
  { code: 'justificatif_domicile', ordre: 5, libelle: 'Justificatif de domicile' },
  { code: 'justificatif_experience', ordre: 6, libelle: "Justificatif d'expériences" },
  { code: 'attestation_mutuelle', ordre: 7, libelle: 'Attestation Mutuelle' },
  { code: 'autres', ordre: 8, libelle: 'Autres documents' },
];

exports.up = async (knex) => {
  await knex.schema.alterTable('types_pieces', (table) => {
    table.integer('ordre').notNullable().defaultTo(0);
    table.string('code_verso').nullable();
  });
  const entite = await knex('entites').where({ code: 'accecit' }).first('id');
  if (!entite) return;
  for (const { code, ...valeurs } of ACCECIT) {
    // eslint-disable-next-line no-await-in-loop
    await knex('types_pieces').where({ entite_id: entite.id, code }).update(valeurs);
  }
};

exports.down = (knex) =>
  knex.schema.alterTable('types_pieces', (table) => {
    table.dropColumn('ordre');
    table.dropColumn('code_verso');
  });
