exports.up = async (knex) => {
  await knex.schema.createTable('historique_statuts', (table) => {
    table.increments('id').primary();
    table.integer('dossier_id').notNullable().references('id').inTable('dossiers');
    table.integer('statut_id').notNullable().references('id').inTable('statuts');
    table.integer('utilisateur_id').notNullable().references('id').inTable('utilisateurs');
    table.integer('motif_id').nullable().references('id').inTable('motifs');
    table.text('commentaire').notNullable();
    table.timestamp('date_changement', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Synchronise dossiers.statut_id à chaque changement de statut (point ouvert n°2 : trigger DB retenu)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION sync_dossier_statut()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE dossiers
      SET statut_id = NEW.statut_id,
          date_maj = NEW.date_changement
      WHERE id = NEW.dossier_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_sync_dossier_statut
    AFTER INSERT ON historique_statuts
    FOR EACH ROW
    EXECUTE FUNCTION sync_dossier_statut();
  `);
};

exports.down = async (knex) => {
  await knex.raw('DROP TRIGGER IF EXISTS trg_sync_dossier_statut ON historique_statuts');
  await knex.raw('DROP FUNCTION IF EXISTS sync_dossier_statut');
  await knex.schema.dropTableIfExists('historique_statuts');
};
