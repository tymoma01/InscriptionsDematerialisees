// Notes libres sur une demande DPAE — table PROPRE aux demandes,
// distincte de `notes_dossier` (migration 035, inchangée) : une demande DPAE n'est pas un dossier
// candidat (elle peut concerner un salarié sans dossier). Même patron que `notes_dossier` : chaque
// note est un ajout permanent (auteur, date), aucune modification ni suppression, donc pas de
// colonne date_modification. Longueur max (1000) imposée côté zod (dpae.routes.js), pas en base.
// Suppression d'une demande -> ses notes partent avec (cascade, même choix que demandes_dpae_sites).
exports.up = (knex) =>
  knex.schema.createTable('notes_demande_dpae', (table) => {
    table.increments('id').primary();
    table.integer('demande_dpae_id').notNullable().references('id').inTable('demandes_dpae').onDelete('CASCADE');
    table.integer('auteur_id').notNullable().references('id').inTable('utilisateurs');
    table.text('contenu').notNullable();
    table.timestamp('date_creation', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['demande_dpae_id']);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('notes_demande_dpae');
