// Ajoute le statut de vérification (accueil/coordination valide ou rejette une pièce reçue) et
// la date de cette vérification à la table `pieces_justificatives` déjà existante (migration
// 015) — pas de nouvelle table : dossier_id, type_piece_id (FK vers `types_pieces`, configurable
// par entité, voir CLAUDE.md Modularité), reference_stockage, nom_fichier, uploaded_by et
// date_upload couvrent déjà les autres champs demandés.
const CONTRAINTE = 'pieces_justificatives_statut_verification_check';

exports.up = (knex) =>
  knex.schema
    .alterTable('pieces_justificatives', (table) => {
      table.string('statut_verification').notNullable().defaultTo('en_attente');
      table.timestamp('date_verification', { useTz: true }).nullable();
    })
    .then(() =>
      knex.raw(
        `ALTER TABLE pieces_justificatives
         ADD CONSTRAINT ${CONTRAINTE}
         CHECK (statut_verification IN ('en_attente', 'valide', 'rejete'))`,
      ),
    );

exports.down = (knex) =>
  knex
    .raw(`ALTER TABLE pieces_justificatives DROP CONSTRAINT IF EXISTS ${CONTRAINTE}`)
    .then(() =>
      knex.schema.alterTable('pieces_justificatives', (table) => {
        table.dropColumn('statut_verification');
        table.dropColumn('date_verification');
      }),
    );
