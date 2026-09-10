// Marque un type de pièce comme acceptant PLUSIEURS documents pour un même dossier (ex. section
// "Autres", demande utilisateur 2026-09-10 : nombre de documents libre, contrairement aux types
// classiques où une seule pièce est active à la fois — remplacée via "Reprendre", voir
// pieceJustificativeService.js STATUTS_UPLOAD_AUTORISES). false par défaut : tous les types
// existants (carte_identite, carte_vitale, RIB...) gardent le comportement actuel "une pièce
// active par type". Générique (pas une colonne "est_autres"), configurable par entité/par type au
// même titre que `obligatoire`/`capture_uniquement` (voir Modularité, CLAUDE.md) — une autre
// entité peut avoir plusieurs types "libres" si besoin, pas réservé au seul code "autres".
exports.up = (knex) =>
  knex.schema.alterTable('types_pieces', (table) => {
    table.boolean('multiple').notNullable().defaultTo(false);
  });

exports.down = (knex) =>
  knex.schema.alterTable('types_pieces', (table) => {
    table.dropColumn('multiple');
  });
