// Statut « Blacklisté » : le statut est une ligne de configuration (comme les autres), les catégories
// de motif sont des motifs de la catégorie « blacklister », et le statut d'avant le blacklistage est
// mémorisé sur le dossier pour être restitué au retrait.
//
// neutralise_rendezvous_actifs reste à false : blacklister ne referme aucun rendez-vous
// automatiquement, la décision revient à l'agent.
const CODE_STATUT = 'blackliste';
const CATEGORIE_MOTIF = 'blacklister';
const MOTIFS = [
  { code: 'absence_repetee', libelle: 'Absence répétée sans prévenir' },
  { code: 'comportement_inapproprie', libelle: 'Comportement inapproprié' },
  { code: 'fausse_declaration', libelle: 'Fausse déclaration ou faux document' },
  { code: 'abandon_poste', libelle: 'Abandon de poste' },
  { code: 'autre', libelle: 'Autre' },
];

exports.up = async (knex) => {
  await knex.schema.alterTable('dossiers', (table) => {
    table.integer('statut_avant_blacklist_id').nullable().references('id').inTable('statuts');
  });

  const entites = await knex('entites').select('id');
  for (const { id: entiteId } of entites) {
    const statutExistant = await knex('statuts').where({ entite_id: entiteId, code: CODE_STATUT }).first();
    if (!statutExistant) {
      const { max } = await knex('statuts').where({ entite_id: entiteId }).max('ordre as max').first();
      await knex('statuts').insert({
        entite_id: entiteId,
        code: CODE_STATUT,
        libelle: 'Blacklisté',
        ordre: Math.max(Number(max ?? 0), 150) + 10,
        est_initial: false,
        est_final: true,
        neutralise_rendezvous_actifs: false,
      });
    }

    for (const motif of MOTIFS) {
      const existant = await knex('motifs').where({ entite_id: entiteId, categorie: CATEGORIE_MOTIF, code: motif.code }).first();
      if (!existant) {
        await knex('motifs').insert({ entite_id: entiteId, categorie: CATEGORIE_MOTIF, code: motif.code, libelle: motif.libelle, actif: true });
      }
    }
  }
};

// Le retour arrière échoue volontairement si un dossier est encore blacklisté ou si l'historique
// référence le statut/les motifs (clés étrangères) : aucune donnée n'est réécrite silencieusement.
exports.down = async (knex) => {
  await knex.schema.alterTable('dossiers', (table) => {
    table.dropColumn('statut_avant_blacklist_id');
  });
  await knex('motifs').where({ categorie: CATEGORIE_MOTIF }).del();
  await knex('statuts').where({ code: CODE_STATUT }).del();
};
