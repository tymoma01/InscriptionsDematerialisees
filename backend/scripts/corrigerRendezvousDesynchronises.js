// Correction ponctuelle (même patron que scripts/migrerWorkflowSuppressionEnAttenteVerdict.js)
// suite à l'audit du 2026-08-20 (dossier #84) : basculeTestNonRealiseService.js (et son équivalent
// manuel, marquerNonRealise) ne mettaient jusqu'ici à jour que dossiers.statut_id, jamais
// rendezvous.statut — un dossier passé à test_non_realise pouvait donc garder un rendez-vous encore
// affiché "Prévu", avec les boutons Confirmer la présence/Marquer absent/Marquer annulé toujours
// actifs (voir rendezvousService.STATUTS_DOSSIER_RENDEZVOUS_CLOS, corrigé le même jour). Ce script
// ferme, une fois, les rendez-vous restés désynchronisés de ces dossiers.
//
// SCOPE VOLONTAIREMENT LIMITÉ à test_non_realise, PAS aux 3 autres statuts de
// STATUTS_DOSSIER_RENDEZVOUS_CLOS (invalide/valide_envoi_formation/valide_pret_embauche) : ceux-là
// ne se rejoignent QUE depuis une évaluation soumise (evaluationEngine.enregistrerEvaluation, seul
// appelant des codeActions correspondants — vérifié par grep, aucun autre chemin) — leur rendez-vous
// a donc TOUJOURS une évaluation liée (evaluations.rendezvous_id), le test a réellement eu lieu.
// Un premier essai de ce script avec les 4 statuts a incorrectement marqué "absent (Test non
// réalisé)" 5 rendez-vous ayant pourtant une évaluation 'valide' rattachée (dossiers #69/#74/#85/
// #89/#91) — immédiatement reverti manuellement. Cette classe de dossiers ne doit JAMAIS être
// touchée ici : voir catégorisation par evaluation_id (rendezvousService.categoriserStatutRendezvous),
// déjà correcte sans toucher rendezvous.statut.
//
// Bascule volontairement CE script directement sur rendezvousRepository.mettreAJourStatutRendezvous
// plutôt que sur rendezvousService.changerStatutRendezvous : ce dernier refuse maintenant toute
// action sur un rendez-vous dont le dossier est déjà dans un état "clos" (ErreurRendezvousDossierClos)
// — exactement la situation ici. Le garde-fou protège un agent qui cliquerait un bouton resté
// affiché à tort ; il ne doit pas empêcher CE script de corriger justement ces cas-là.
//
// N'agit que sur les rendez-vous encore 'prevu'/'confirme', SANS évaluation liée (double sécurité,
// en plus du filtre sur statut_dossier = test_non_realise), d'un dossier déjà test_non_realise —
// idempotent (un dossier déjà corrigé, ou dont le rendez-vous a depuis été traité manuellement, ne
// réapparaît plus au run suivant).
//
// Usage : node scripts/corrigerRendezvousDesynchronises.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

const STATUT_DOSSIER_CIBLE = 'test_non_realise';
const CATEGORIE_MOTIF_DESISTEMENT = 'desistement';
const CODE_MOTIF = 'test_non_realise';

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter d'abord scripts/seedEntite.js`);
    }

    const motif = await bd('motifs')
      .where({ entite_id: entite.id, categorie: CATEGORIE_MOTIF_DESISTEMENT, code: CODE_MOTIF })
      .first();
    if (!motif) {
      throw new Error(
        `Motif de désistement « ${CODE_MOTIF} » introuvable pour « ${codeEntite} » — exécuter d'abord node scripts/seedMotifsDesistement.js ${codeEntite}`,
      );
    }

    const incoherents = await bd('dossiers as d')
      .join('statuts as s', 'd.statut_id', 's.id')
      .join('rendezvous as r', 'r.dossier_id', 'd.id')
      .where('d.entite_id', entite.id)
      .where('s.code', STATUT_DOSSIER_CIBLE)
      .whereIn('r.statut', ['prevu', 'confirme'])
      .whereNotExists(function () {
        this.select(1).from('evaluations').whereRaw('evaluations.rendezvous_id = r.id');
      })
      .select('d.id as dossier_id', 's.code as statut_dossier', 'r.id as rendezvous_id', 'r.statut as statut_rendezvous');

    if (incoherents.length === 0) {
      console.log(`Aucun rendez-vous désynchronisé pour « ${codeEntite} » ✔`);
      return;
    }

    for (const ligne of incoherents) {
      await bd('rendezvous')
        .where({ id: ligne.rendezvous_id })
        .update({ statut: 'absent', motif_id: motif.id });
      console.log(
        `Rendez-vous #${ligne.rendezvous_id} (dossier #${ligne.dossier_id}, statut dossier « ${ligne.statut_dossier} ») ` +
          `« ${ligne.statut_rendezvous} » -> « absent » (motif « ${CODE_MOTIF} ») ✔`,
      );
    }

    console.log(`${incoherents.length} rendez-vous corrigé(s) pour « ${codeEntite} » ✔`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/corrigerRendezvousDesynchronises.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec de la correction ✘');
  console.error(erreur.message);
  process.exit(1);
});
