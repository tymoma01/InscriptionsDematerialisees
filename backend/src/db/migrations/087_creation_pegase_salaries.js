// Création du salarié dans Pégase à la validation d'une demande DPAE de nouvelle embauche (voir
// integrations/pegase/pegaseSalarieService.js).
//
// `pegase_salaries` : une ligne par demande DPAE concernée, résultat du dernier envoi — salarié créé
// (id Pégase), doublon détecté (id du salarié existant) ou erreur (message lisible par la RH).
// `base` : base Pégase où vit ce salarié (un id Pégase n'a de sens que dans sa base). Les pièces
// justificatives déjà transmises sont mémorisées par code de type de pièce : une relance ne renvoie
// que celles qui manquent et ne recrée jamais le salarié.
//
// `entites.pegase_actif` / `pegase_config` : même patron que smartof_actif / smartof_config.
// ACCECIT a une base Pégase par division, chacune avec son token (secret Key Vault), son agence et
// son type de document pour les pièces. Base Hôtellerie : agence HOTEL (id "1"), documents en
// « Dossier salarié » (DS1). Base Tertiaire : agence et type de document à relever dans cette base
// dès que son token est disponible ; tant qu'ils manquent, l'envoi est refusé avec un message clair.
// Une division « autre » (ou absente) va vers la base par défaut.
exports.up = async (knex) => {
  await knex.schema.createTable('pegase_salaries', (table) => {
    table.increments('id').primary();
    table.integer('demande_dpae_id').notNullable().unique().references('id').inTable('demandes_dpae');
    table.string('base');
    table.string('statut').notNullable();
    table.string('pegase_personnel_id');
    table.text('message');
    table.jsonb('avertissements').notNullable().defaultTo('[]');
    table.jsonb('pieces_envoyees').notNullable().defaultTo('[]');
    table.jsonb('pieces_en_erreur').notNullable().defaultTo('[]');
    table.timestamp('date_tentative', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw("ALTER TABLE pegase_salaries ADD CONSTRAINT pegase_salaries_statut_check CHECK (statut IN ('cree', 'doublon', 'erreur'))");

  await knex.schema.alterTable('entites', (table) => {
    table.boolean('pegase_actif').notNullable().defaultTo(false);
    table.jsonb('pegase_config').notNullable().defaultTo('{}');
  });
  await knex('entites')
    .where({ code: 'accecit' })
    .update({
      pegase_actif: true,
      pegase_config: JSON.stringify({
        base_par_defaut: 'hotellerie',
        bases: {
          hotellerie: { secret: 'pegase-token', agence: '1', code_type_document: 'DS1' },
          tertiaire: { secret: 'pegase-token-tertiaire', agence: null, code_type_document: null },
        },
      }),
    });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('entites', (table) => {
    table.dropColumn('pegase_actif');
    table.dropColumn('pegase_config');
  });
  await knex.schema.dropTableIfExists('pegase_salaries');
};
