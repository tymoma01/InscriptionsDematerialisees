// Diagnostic en LECTURE SEULE : dossiers du Tertiaire (typePoste « bureau ») qui ont atteint, ou ont
// actuellement, un statut de formation. Règle métier : aucun dossier Tertiaire ne passe en formation ; une
// ligne ici signale une incohérence de données. Rien n'est modifié.
//
// Usage : node scripts/diagnosticDossiersTertiaireFormation.js

const { obtenirKnex } = require('../src/db/knex');

const STATUTS_FORMATION = ['valide_envoi_formation', 'formation_non_validee'];

async function diagnostic() {
  const bd = await obtenirKnex();
  try {
    const lignes = await bd('dossiers')
      .join('statuts', 'statuts.id', 'dossiers.statut_id')
      .join('candidats', 'candidats.id', 'dossiers.candidat_id')
      .join('dossier_donnees_formulaire as bloc', function jointure() {
        this.on('bloc.dossier_id', '=', 'dossiers.id').andOn('bloc.bloc_code', '=', bd.raw('?', ['disponibilites']));
      })
      .whereRaw("bloc.donnees ->> 'typePoste' = 'bureau'")
      .where((condition) =>
        condition.whereIn('statuts.code', STATUTS_FORMATION).orWhereExists(
          bd('historique_statuts')
            .join('statuts as passes', 'passes.id', 'historique_statuts.statut_id')
            .whereRaw('historique_statuts.dossier_id = dossiers.id')
            .whereIn('passes.code', STATUTS_FORMATION),
        ),
      )
      .select('dossiers.id', 'candidats.nom', 'candidats.prenom', 'statuts.code as statut_courant')
      .orderBy('dossiers.id');
    if (lignes.length === 0) {
      console.log('Aucun dossier Tertiaire avec un statut de formation ✔');
      return;
    }
    console.log(`${lignes.length} dossier(s) Tertiaire avec un statut de formation (incohérence de données) :`);
    for (const ligne of lignes) console.log(`  #${ligne.id} ${ligne.prenom} ${ligne.nom} — statut courant : ${ligne.statut_courant}`);
  } finally {
    await bd.destroy();
  }
}

diagnostic().catch((erreur) => {
  console.error('Échec du diagnostic ✘');
  console.error(erreur.message);
  process.exit(1);
});
