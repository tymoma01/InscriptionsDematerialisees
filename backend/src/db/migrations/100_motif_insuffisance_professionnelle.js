// Catégorie de refus définitif « Insuffisance professionnelle », placée en tête de la liste.
// La table `motifs` était triée par id : une colonne `ordre` (0 par défaut, donc sans effet sur les
// autres catégories de motifs) permet de placer la nouvelle ligne avant les existantes.
const CATEGORIE_MOTIF = 'blacklister';
const CODE = 'insuffisance_professionnelle';

exports.up = async (knex) => {
  await knex.schema.alterTable('motifs', (table) => {
    table.integer('ordre').notNullable().defaultTo(0);
  });

  const entites = await knex('entites').select('id');
  for (const { id: entiteId } of entites) {
    const existant = await knex('motifs').where({ entite_id: entiteId, categorie: CATEGORIE_MOTIF, code: CODE }).first();
    if (!existant) {
      await knex('motifs').insert({
        entite_id: entiteId,
        categorie: CATEGORIE_MOTIF,
        code: CODE,
        libelle: 'Insuffisance professionnelle',
        actif: true,
        ordre: -1,
      });
    }
  }
};

// Échoue volontairement si un refus définitif référence déjà le motif (clé étrangère).
exports.down = async (knex) => {
  await knex('motifs').where({ categorie: CATEGORIE_MOTIF, code: CODE }).del();
  await knex.schema.alterTable('motifs', (table) => {
    table.dropColumn('ordre');
  });
};
