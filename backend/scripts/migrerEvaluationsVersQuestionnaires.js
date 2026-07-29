// Migration ponctuelle (même patron que scripts/migrerWorkflowAccecitV3.js — pas un seed
// rejouable indéfiniment) : convertit les évaluations déjà enregistrées sur l'ancien modèle plat
// (criteres_evaluation/evaluation_resultats) vers le nouveau modèle par questionnaire/poste (voir
// migration 037, scripts/seedQuestionnairesEvaluation.js) — un seul système de stockage des
// réponses au final, pas deux qui coexistent indéfiniment.
//
// Prérequis : scripts/seedQuestionnairesEvaluation.js <code_entite> déjà exécuté (le questionnaire
// générique et sa question "evaluation_test" doivent exister, avec un item par ancien critère).
//
// Ne touche PAS criteres_evaluation/evaluation_resultats (conservées en base pour l'historique,
// jamais supprimées) — ajoute seulement les lignes équivalentes dans evaluation_reponses.
// Idempotent : une évaluation déjà migrée (au moins une ligne evaluation_reponses existante) est
// resautée.
//
// Usage : node scripts/migrerEvaluationsVersQuestionnaires.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

// Ancienne échelle (VALEURS_CRITERE_AUTORISEES, evaluationEngine.js avant ce changement) vers la
// nouvelle (ACQUIS_AUTORISEES) — même échelle à 3 niveaux, vocabulaire aligné sur les
// questionnaires hôtel (Acquis/Non acquis/A améliorer).
const CONVERSION_VALEUR = {
  conforme: 'acquis',
  non_conforme: 'non_acquis',
  a_ameliorer: 'a_ameliorer',
};

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter scripts/seedEntite.js.`);
    }

    const questionnaireGenerique = await bd('questionnaires_evaluation')
      .where({ entite_id: entite.id, poste_code: null })
      .first();
    if (!questionnaireGenerique) {
      throw new Error(
        `Questionnaire générique introuvable pour « ${codeEntite} » — exécuter d'abord scripts/seedQuestionnairesEvaluation.js.`,
      );
    }

    const question = await bd('questions_evaluation')
      .where({ questionnaire_id: questionnaireGenerique.id, code: 'evaluation_test' })
      .first();
    if (!question) {
      throw new Error(
        `Question « evaluation_test » introuvable — exécuter d'abord scripts/seedQuestionnairesEvaluation.js.`,
      );
    }

    const items = await bd('question_items_evaluation').where({ question_id: question.id });
    const itemIdParCode = new Map(items.map((item) => [item.code, item.id]));

    const evaluations = await bd('evaluations')
      .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
      .where('dossiers.entite_id', entite.id)
      .select('evaluations.id');

    let nbMigrees = 0;
    let nbDejaMigrees = 0;

    for (const { id: evaluationId } of evaluations) {
      const dejaMigree = await bd('evaluation_reponses').where({ evaluation_id: evaluationId }).first();
      if (dejaMigree) {
        nbDejaMigrees += 1;
        continue;
      }

      const resultats = await bd('evaluation_resultats')
        .join('criteres_evaluation', 'criteres_evaluation.id', 'evaluation_resultats.critere_id')
        .where('evaluation_resultats.evaluation_id', evaluationId)
        .select('criteres_evaluation.code as critere_code', 'evaluation_resultats.valeur');

      for (const { critere_code: critereCode, valeur } of resultats) {
        const questionItemId = itemIdParCode.get(critereCode);
        if (!questionItemId) {
          throw new Error(
            `Item « ${critereCode} » introuvable dans le questionnaire générique — vérifier scripts/seedQuestionnairesEvaluation.js.`,
          );
        }
        const valeurConvertie = CONVERSION_VALEUR[valeur];
        if (!valeurConvertie) {
          throw new Error(`Valeur « ${valeur} » (evaluation ${evaluationId}) sans correspondance dans CONVERSION_VALEUR.`);
        }

        await bd('evaluation_reponses').insert({
          evaluation_id: evaluationId,
          question_id: question.id,
          question_item_id: questionItemId,
          valeur: valeurConvertie,
        });
      }

      nbMigrees += 1;
      console.log(`Évaluation id=${evaluationId} migrée (${resultats.length} réponse(s)) ✔`);
    }

    console.log(`--- Terminé : ${nbMigrees} évaluation(s) migrée(s), ${nbDejaMigrees} déjà migrée(s) ---`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/migrerEvaluationsVersQuestionnaires.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec de la migration ✘');
  console.error(erreur.message);
  process.exit(1);
});
