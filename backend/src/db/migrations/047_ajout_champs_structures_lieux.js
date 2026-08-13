// Remplace le champ texte libre unique `libelle` (migration 044, formaté à la main avec des
// séparateurs " | " pour distinguer adresse/accès/instructions — audit du 2026-08-13) par trois
// colonnes structurées : `adresse` (obligatoire à terme), `metro_acces` et `instructions`
// (optionnels). Migration additive et réversible en deux temps, même patron que
// `motif_id`/`lieu_id` (migrations 031/045) : les trois nouvelles colonnes sont nullable pour
// permettre le backfill (voir scripts/migrerLieuxVersChampsStructures.js) avant toute contrainte
// applicative — la validation "adresse obligatoire" reste portée par lieuService.js/le schéma Zod
// de lieux.routes.js, pas par une contrainte SQL NOT NULL immédiate.
//
// `libelle` passe nullable ici : le code applicatif (lieuRepository.creerLieu/modifierLieu) ne
// l'écrit plus après cette migration, une ligne créée à partir de maintenant n'a donc plus de
// valeur pour cette colonne — la conserver NOT NULL ferait échouer tout INSERT futur. La colonne
// elle-même n'est PAS supprimée ici (voir CLAUDE.md/consigne : suppression différée à une
// migration séparée, une fois la bascule confirmée stable en production) — elle reste en base,
// gelée à son dernier contenu, pour permettre un retour arrière simple tant que le nouveau schéma
// n'a pas fait ses preuves.
exports.up = (knex) =>
  knex.schema.alterTable('lieux', (table) => {
    table.string('adresse').nullable();
    table.string('metro_acces').nullable();
    table.text('instructions').nullable();
    table.string('libelle').nullable().alter();
  });

// Suppose qu'aucune ligne n'a de `libelle` NULL au moment du rollback (vrai tant que le backfill/
// la bascule n'ont pas laissé de ligne sans libellé — cas non rencontré dans ce projet à ce stade,
// voir audit du 2026-08-13 : 2 lieux seulement, tous deux avec un libelle existant).
exports.down = (knex) =>
  knex.schema.alterTable('lieux', (table) => {
    table.dropColumn('adresse');
    table.dropColumn('metro_acces');
    table.dropColumn('instructions');
    table.string('libelle').notNullable().alter();
  });
