// Migration ponctuelle (pas un seed rejouable comme scripts/seedQuestionnairesEvaluation.js) :
// rétro-remplit evaluations.poste_code (migration 038) pour les évaluations déjà enregistrées
// avant l'ajout de cette colonne — dérivé des réponses déjà en base (evaluation_reponses ->
// questions_evaluation -> questionnaires_evaluation.poste_code), jamais deviné. Les évaluations
// sur le questionnaire générique (poste_code NULL) restent NULL, c'est déjà la valeur correcte.
// Idempotent : une évaluation qui a déjà un poste_code non NULL est resautée.
//
// Usage : node scripts/retrofillPosteCodeEvaluations.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable — exécuter scripts/seedEntite.js.`);
    }

    const evaluations = await bd('evaluations')
      .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
      .where('dossiers.entite_id', entite.id)
      .whereNull('evaluations.poste_code')
      .select('evaluations.id');

    let nbMisAJour = 0;
    for (const { id: evaluationId } of evaluations) {
      const ligne = await bd('evaluation_reponses')
        .join('questions_evaluation', 'questions_evaluation.id', 'evaluation_reponses.question_id')
        .join('questionnaires_evaluation', 'questionnaires_evaluation.id', 'questions_evaluation.questionnaire_id')
        .where('evaluation_reponses.evaluation_id', evaluationId)
        .whereNotNull('questionnaires_evaluation.poste_code')
        .select('questionnaires_evaluation.poste_code')
        .first();

      if (!ligne) {
        console.log(`Évaluation id=${evaluationId} : questionnaire générique (poste_code NULL) — rien à faire.`);
        continue;
      }

      await bd('evaluations').where({ id: evaluationId }).update({ poste_code: ligne.poste_code });
      console.log(`Évaluation id=${evaluationId} : poste_code = « ${ligne.poste_code} » ✔`);
      nbMisAJour += 1;
    }

    console.log(`--- Terminé : ${nbMisAJour} évaluation(s) mise(s) à jour sur ${evaluations.length} vérifiée(s) ---`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/retrofillPosteCodeEvaluations.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec ✘');
  console.error(erreur.message);
  process.exit(1);
});
