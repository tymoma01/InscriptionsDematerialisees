const VALEUR_PLACEHOLDER = 'À COMPLÉTER';

exports.up = (knex) =>
  knex.schema
    .alterTable('candidats', (table) => {
      table.string('nom_naissance');
      table.string('lieu_naissance');
      table.string('nationalite');
    })
    // Backfill des candidats déjà en base (aucune valeur connue pour ces nouveaux champs)
    // avant de passer les colonnes en NOT NULL, sinon l'ALTER TABLE échoue.
    .then(() =>
      knex('candidats').whereNull('nom_naissance').update({
        nom_naissance: VALEUR_PLACEHOLDER,
        lieu_naissance: VALEUR_PLACEHOLDER,
        nationalite: VALEUR_PLACEHOLDER,
      })
    )
    .then(() =>
      knex.schema.alterTable('candidats', (table) => {
        table.string('nom_naissance').notNullable().alter();
        table.string('lieu_naissance').notNullable().alter();
        table.string('nationalite').notNullable().alter();
      })
    );

exports.down = (knex) =>
  knex.schema.alterTable('candidats', (table) => {
    table.dropColumn('nom_naissance');
    table.dropColumn('lieu_naissance');
    table.dropColumn('nationalite');
  });
