// Correction, par un agent, de la disponibilité déclarée par un candidat "Validé - prêt à
// l'embauche" (audit 2026-09-28, demande utilisateur — filtre "Disponibilité des candidats prêts
// à l'embauche", Dossiers candidats) — SANS écraser la déclaration d'origine du candidat (bloc
// 'disponibilites' de dossier_donnees_formulaire, JSONB), qui reste inchangée et consultable en
// lecture seule. Une LIGNE PAR CORRECTION (jamais un UPDATE en place) : la plus récente pour un
// dossier donné fait foi (voir disponibiliteEmbaucheRepository.trouverDerniereCorrection),
// l'historique complet reste consultable en base au besoin.
//
// PK entière (increments), pas uuid : convention du projet (voir migrations 006/023 et al.,
// aucune table n'utilise uuid comme clé primaire).
//
// date_debut NOT NULL : toujours obligatoire dans la fenêtre de correction (contrairement à la
// déclaration d'origine, où elle ne l'est que si le candidat n'est pas disponible immédiatement) —
// une correction ne porte jamais la notion "immédiate", seulement une date concrète (éventuellement
// celle du jour, préremplie côté front si la disponibilité d'origine était immédiate).
// date_fin NULLABLE : reste facultative, comme dans la déclaration d'origine (disponibilité "à
// partir du X, sans fin connue").
// commentaire NOT NULL : obligatoire (voir dossierService.corrigerDisponibiliteEmbauche).
// utilisateur_id NOT NULL : jamais de correction anonyme/système ici, contrairement à
// journal_audit qui autorise utilisateur_id NULL pour des actions automatiques.
exports.up = (knex) =>
  knex.schema.createTable('disponibilites_embauche_corrigees', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.date('date_debut').notNullable();
    table.date('date_fin').nullable();
    table.text('commentaire').notNullable();
    table.integer('utilisateur_id').notNullable().references('id').inTable('utilisateurs');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Index composite : trouverDerniereCorrection trie sur ces deux colonnes pour chaque
    // dossier_id — voir migration 064 (même raisonnement) pour un index équivalent déjà posé sur
    // journal_audit.
    table.index(['dossier_id', 'created_at']);
  });

exports.down = (knex) => knex.schema.dropTableIfExists('disponibilites_embauche_corrigees');
