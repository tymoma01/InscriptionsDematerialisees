// Correctif ponctuel — dossier #69, évaluation #6 (24/07/2026).
//
// Diagnostic (audit "Poste non spécifié", tableau de bord KPI) : evaluations.id=6 n'a aucune ligne
// dans evaluations_postes, donc s'affiche comme "Poste non spécifié" dans le graphique de
// répartition par poste. Cause confirmée en base : ses réponses (evaluation_reponses) proviennent
// du questionnaire GÉNÉRIQUE (questionnaires_evaluation.poste_code = NULL, question unique
// "Évaluation du test"), pas d'un des deux questionnaires bureau dédiés (nettoyage/chef_equipe) —
// cohérent avec le diagnostic déjà posé dans corrigerTransitionDossier69.js (2026-08-06) : cette
// ligne est une donnée de test insérée directement en base, hors du flux applicatif normal.
//
// Décision (utilisateur, confirmée explicitement — voir conversation) : associer les 2 postes
// déclarés au formulaire d'inscription du dossier (dossier_donnees_formulaire, bloc
// "disponibilites" : posteBureau = ['nettoyage', 'chef_equipe']) plutôt que de laisser "Poste non
// spécifié". Assumé et ponctuel, PAS une reconstitution fidèle du contenu réel de l'évaluation
// (qui reste un questionnaire générique sans critère propre à l'un ou l'autre poste) — à la
// différence de scripts/retrofillPosteCodeEvaluations.js, qui ne backfille qu'à partir de preuves
// déjà en base (réponses réellement données à un questionnaire dédié), jamais devinées.
//
// evaluationRepository.enregistrerPostesEvaluation réutilisée telle quelle (même insertion que le
// flux normal d'evaluationEngine.enregistrerEvaluation), pas de SQL ad hoc dupliqué ici.
//
// Idempotent : si evaluations_postes contient déjà des lignes pour cette évaluation, le script
// s'arrête sans rien modifier plutôt que de risquer un doublon.
//
// Usage : node scripts/corrigerPostesEvaluationDossier69.js
const { obtenirKnex } = require('../src/db/knex');
const evaluationRepository = require('../src/core/evaluation/evaluationRepository');

const DOSSIER_ID = 69;
const EVALUATION_ID = 6;
const POSTES_A_ASSOCIER = ['nettoyage', 'chef_equipe'];

async function main() {
  const bd = await obtenirKnex();
  try {
    await bd.transaction(async (trx) => {
      const evaluation = await trx('evaluations').where({ id: EVALUATION_ID, dossier_id: DOSSIER_ID }).first();
      if (!evaluation) {
        throw new Error(`Évaluation #${EVALUATION_ID} introuvable pour le dossier #${DOSSIER_ID} — arrêt sans rien modifier.`);
      }

      const postesExistants = await trx('evaluations_postes').where({ evaluation_id: EVALUATION_ID }).select('poste_code');
      if (postesExistants.length > 0) {
        console.log(
          `Évaluation #${EVALUATION_ID} a déjà ${postesExistants.length} poste(s) associé(s) (${postesExistants.map((p) => p.poste_code).join(', ')}) — arrêt, rien à faire (idempotent).`,
        );
        return;
      }

      await evaluationRepository.enregistrerPostesEvaluation(trx, EVALUATION_ID, POSTES_A_ASSOCIER);
      console.log(`Évaluation #${EVALUATION_ID} : postes associés = ${POSTES_A_ASSOCIER.join(', ')} ✔`);
    });

    const postesApres = await bd('evaluations_postes').where({ evaluation_id: EVALUATION_ID }).orderBy('poste_code').select('poste_code');
    console.log(`\nVérification post-correctif — evaluations_postes pour évaluation #${EVALUATION_ID} :`, postesApres.map((p) => p.poste_code));
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
