// Marque un type de pièce comme "capturable uniquement à la caméra" (ex. Photo d'identité,
// décision produit 2026-08-17) — false par défaut : la grande majorité des pièces (carte
// d'identité, carte vitale, RIB...) gardent les deux options (Prendre une photo / Choisir un
// fichier), voir CaptureTablette.jsx. Générique (pas une colonne "photo_identite_seulement"),
// configurable par entité/par type au même titre que `obligatoire` (voir Modularité, CLAUDE.md).
exports.up = (knex) =>
  knex.schema.alterTable('types_pieces', (table) => {
    table.boolean('capture_uniquement').notNullable().defaultTo(false);
  });

exports.down = (knex) =>
  knex.schema.alterTable('types_pieces', (table) => {
    table.dropColumn('capture_uniquement');
  });
