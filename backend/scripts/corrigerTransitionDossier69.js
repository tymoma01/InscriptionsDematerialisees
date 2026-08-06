// Correctif ponctuel — dossier #69 (candidat de test "TEST ETEST").
//
// Diagnostic (voir conversation du 2026-08-06, tableau consolidé du dashboard KPI) : ce dossier
// affichait simultanément le statut "Test planifié" ET l'indicateur "Test réussi", contradiction
// impossible via le parcours normal de l'application (evaluationEngine.enregistrerEvaluation
// insère l'évaluation ET fait transitionner le dossier dans LA MÊME transaction — voir son
// commentaire "un dossier ne peut plus jamais être à la fois évalué et encore test_planifie au
// même instant"). Scan complet de toutes les évaluations de l'entité : dossier #69 est le SEUL
// dans ce cas (une évaluation "valide" existe — evaluations.id=6 — sans qu'aucune transition de
// statut n'ait suivi dans historique_statuts, qui s'arrête à test_planifie).
//
// Cause retenue : la ligne evaluations.id=6 est une donnée de test insérée directement en base,
// hors du flux applicatif normal (date_evaluation antérieure à la date du rendez-vous associé,
// orientation NULL alors qu'obligatoire pour un verdict positif soumis par un Formateur non
// Inspecteur — evaluationEngine.js, ORIENTATIONS_AUTORISEES) : elle n'a jamais pu passer par
// enregistrerEvaluation() telle quelle.
//
// Décision (utilisateur, 2026-08-06) : faire transiter le dossier plutôt que supprimer
// l'évaluation, avec l'orientation "envoi_formation" (choisie explicitement, l'évaluation elle-même
// ne permettant pas de la déduire).
//
// Deux étapes, dans une seule transaction :
// 1. Complète l'évaluation #6 avec orientation='envoi_formation' (actuellement NULL) — pour
//    qu'elle redevienne cohérente avec ce qu'un Formateur aurait réellement pu soumettre (voir
//    validation dans enregistrerEvaluation, contournée par l'insertion directe d'origine).
// 2. Applique la transition test_planifie -> valide_envoi_formation (codeAction
//    'valider_envoi_formation', vérifiée en base : autorisée pour le rôle 'formateur', sans motif
//    requis) via workflowEngine.appliquerTransition — même moteur que la route
//    /transitions normale, pas une mise à jour SQL ad hoc de dossiers.statut_id : garantit que
//    l'historique_statuts, la validation de la transition existante et l'autorisation par rôle
//    passent par le même chemin que n'importe quelle transition réelle.
//
// Usage : node scripts/corrigerTransitionDossier69.js
const { obtenirKnex } = require('../src/db/knex');
const workflowEngine = require('../src/core/workflow/workflowEngine');

const DOSSIER_ID = 69;
const EVALUATION_ID = 6;
const FORMATEUR_ID = 8; // Fabienne Formateur, formateur assigné au rendez-vous évalué (rendezvous.id=18).
const ORIENTATION_RETENUE = 'envoi_formation';
const CODE_ACTION = 'valider_envoi_formation';

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit', actif: true }).first();
    if (!entite) throw new Error('Entité « accecit » introuvable ou inactive.');

    await bd.transaction(async (trx) => {
      const evaluation = await trx('evaluations').where({ id: EVALUATION_ID, dossier_id: DOSSIER_ID }).first();
      if (!evaluation) {
        throw new Error(`Évaluation #${EVALUATION_ID} introuvable pour le dossier #${DOSSIER_ID} — arrêt sans rien modifier.`);
      }
      if (evaluation.resultat_global !== 'valide') {
        throw new Error(
          `Évaluation #${EVALUATION_ID} : resultat_global="${evaluation.resultat_global}" (attendu "valide") — arrêt, ce script ne corrige que ce cas précis.`,
        );
      }

      console.log(`Évaluation #${EVALUATION_ID} avant correctif : orientation=${evaluation.orientation}`);
      await trx('evaluations').where({ id: EVALUATION_ID }).update({ orientation: ORIENTATION_RETENUE });
      console.log(`Évaluation #${EVALUATION_ID} : orientation mise à "${ORIENTATION_RETENUE}" ✔`);

      const { statutDestinationId } = await workflowEngine.appliquerTransition(
        entite,
        {
          dossierId: DOSSIER_ID,
          codeAction: CODE_ACTION,
          commentaire:
            'Correctif ponctuel : évaluation #6 (verdict valide, orientation envoi_formation) enregistrée sans que ' +
            'la transition de statut correspondante ne suive (donnée de test insérée hors du flux applicatif normal, ' +
            'voir diagnostic du 2026-08-06) — transition appliquée a posteriori pour lever la contradiction ' +
            'statut/indicateur observée sur le dashboard KPI.',
          utilisateurId: FORMATEUR_ID,
          roleCode: 'formateur',
        },
        trx,
      );
      console.log(`Dossier #${DOSSIER_ID} : transition "${CODE_ACTION}" appliquée, statut_destination_id=${statutDestinationId} ✔`);
    });

    const dossierApres = await bd('dossiers')
      .join('statuts', 'statuts.id', 'dossiers.statut_id')
      .where('dossiers.id', DOSSIER_ID)
      .select('statuts.code', 'statuts.libelle')
      .first();
    console.log(`\nDossier #${DOSSIER_ID} : statut courant = "${dossierApres.code}" (${dossierApres.libelle}) ✔`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
