// Journal de notes libres sur un dossier, indépendant des relances (voir core/dossier/
// notesDossierRepository.js) — chaque note est un ajout permanent, même patron que
// historique_statuts et relances : pas de modification/suppression prévue pour l'instant, donc
// pas de colonne date_modification.
exports.up = (knex) =>
  knex.schema.createTable('notes_dossier', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.integer('auteur_id').notNullable().references('id').inTable('utilisateurs');
    // Longueur max (1000) imposée côté zod (notes.routes.js), pas ici — même choix que
    // relances.commentaire (migration 034), aucune contrainte CHECK en base.
    table.text('contenu').notNullable();
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

exports.down = (knex) => knex.schema.dropTableIfExists('notes_dossier');
