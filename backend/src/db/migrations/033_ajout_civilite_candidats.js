const VALEUR_PLACEHOLDER = 'À COMPLÉTER';

exports.up = (knex) =>
  knex.schema
    .alterTable('candidats', (table) => {
      table.string('civilite');
    })
    // Backfill des candidats déjà en base (aucune valeur connue pour ce nouveau champ) avant de
    // passer la colonne en NOT NULL, même patron que la migration 026.
    .then(() => knex('candidats').whereNull('civilite').update({ civilite: VALEUR_PLACEHOLDER }))
    .then(() =>
      knex.schema.alterTable('candidats', (table) => {
        table.string('civilite').notNullable().alter();
      })
    );

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.dropColumn('civilite');
  });
