// Lieux où un test peut se dérouler (CLAUDE.md, étape "Envoi en test" — jusqu'ici toujours
// l'adresse ACCECIT en dur, voir LIEU_TEST_ACCECIT dans generateurIcs.js) — extensible par
// entité : ACCECIT reçoit désormais aussi des candidats sur site partenaire (ex. hôtel), d'autres
// adresses viendront s'ajouter progressivement. Même schéma minimal que `motifs`/`types_pieces`
// (migrations 007/014) : `entite_id` + `code` + `libelle` + `actif`, pas de colonne `categorie`
// (contrairement à `motifs`, qui distingue désistement/rejet/relance) — un seul type de liste ici,
// à faire évoluer si un vrai besoin de sous-catégorie apparaît un jour.
exports.up = (knex) =>
  knex.schema.createTable('lieux', (table) => {
    table.increments('id').primary();
    table.integer('entite_id').notNullable().references('id').inTable('entites');
    table.string('code').notNullable();
    table.string('libelle').notNullable();
    table.boolean('actif').notNullable().defaultTo(true);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('lieux');
