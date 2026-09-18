// Correctif ponctuel — retrait de "DEBUTANT(E)" du bloc "Connaissance du vocabulaire hôtelier"
// (audit 2026-09-19, demande utilisateur), même patron que scripts/
// supprimerItemsOrphelinsDebutant.js (audit 2026-08-26, même classe de problème).
//
// Cause racine : ce bloc "Connaissance du vocabulaire hôtelier" (question 'vocabulaire_hotelier',
// type 'choix_multiple') portait un item 'debutant' EN DOUBLE avec la question autonome dédiée
// 'debutant' (type 'oui_non', voir seedQuestionnairesEvaluation.js) — deux emplacements de
// stockage distincts pour la même information (question_item_id vs question_id), source de
// confusion pour l'agent qui remplit le formulaire. seedQuestionnairesEvaluation.js retire
// désormais cet item de la config (femme_valet_chambre/equipier), mais le seed ne supprime jamais
// lui-même un item déjà en base qui disparaît de la config (additif/mise à jour seulement) — sans
// ce script, cet item resterait une ligne orpheline dans question_items_evaluation, encore
// renvoyée par listerQuestionsAvecItems et donc encore affichée.
//
// Résolution DYNAMIQUE par (poste_code, code question, code item) plutôt que par id numérique en
// dur (audit 2026-09-19, 2e passe — corrige la 1re version de ce script, qui codait en dur les id
// DEV 24/66 : ces id diffèrent en PROD, 73/113, rendant le script inutilisable tel quel sur un 2e
// environnement). Le garde-fou reste équivalent : n'agit QUE si l'état trouvé correspond exactement
// à la structure attendue (poste + code question + code item), sinon signale l'écart sans rien
// modifier. Idempotent : un environnement où l'item a déjà été supprimé (ex. DEV, 2026-09-19)
// ressort simplement "aucun item trouvé", sans erreur.
//
// Audit préalable :
// - DEV (2026-09-19) : item id=24 (femme_valet_chambre) référencé par 6 réponses, id=66 (equipier)
//   par 3 réponses — 9 au total. Décision utilisateur : suppression définitive, déjà exécutée.
// - PROD (2026-09-19) : item id=73 (femme_valet_chambre) référencé par 7 réponses, id=113
//   (equipier) par 4 réponses — 11 au total. Décision utilisateur : suppression définitive.
// Dans les deux cas, réponses journalisées dans journal_audit avant suppression pour garder une
// trace de ce qui a été retiré. N'affecte PAS la question autonome 'debutant'/'debutante' (type
// 'oui_non') ni ses propres réponses, seul le doublon dans 'vocabulaire_hotelier' est concerné.
// cafetier non concerné : pas de bloc 'vocabulaire_hotelier' séparé pour ce poste (structure
// différente, "vocabulaire hôtelier" y est un simple item de 'process_nettoyage').
//
// Usage : node scripts/supprimerItemVocabulaireHotelierDoublonDebutant.js [code_entite]
// (code_entite par défaut : accecit)

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const journalAudit = require('../src/core/audit/journalAudit');

const POSTES_CONCERNES = ['femme_valet_chambre', 'equipier'];
const CODE_QUESTION = 'vocabulaire_hotelier';
const CODE_ITEM = 'debutant';

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite, actif: true }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable ou inactive.`);
    }

    const itemsAvant = [];
    for (const posteCode of POSTES_CONCERNES) {
      const item = await bd('question_items_evaluation')
        .join('questions_evaluation', 'questions_evaluation.id', 'question_items_evaluation.question_id')
        .join('questionnaires_evaluation', 'questionnaires_evaluation.id', 'questions_evaluation.questionnaire_id')
        .where({
          'questionnaires_evaluation.entite_id': entite.id,
          'questionnaires_evaluation.poste_code': posteCode,
          'questions_evaluation.code': CODE_QUESTION,
          'question_items_evaluation.code': CODE_ITEM,
        })
        .select('question_items_evaluation.id', 'question_items_evaluation.code', 'question_items_evaluation.libelle')
        .first();
      if (item) itemsAvant.push({ ...item, posteCode });
    }

    if (itemsAvant.length === 0) {
      console.log(`Aucun item "${CODE_ITEM}" trouvé dans "${CODE_QUESTION}" pour « ${codeEntite} » (postes ${POSTES_CONCERNES.join('/')}) — déjà supprimé(s) ✔`);
      return;
    }

    const idsASupprimer = itemsAvant.map((i) => i.id);
    const reponsesAvant = await bd('evaluation_reponses')
      .whereIn('question_item_id', idsASupprimer)
      .select('id', 'evaluation_id', 'question_id', 'question_item_id', 'valeur');
    console.log(`Entité « ${codeEntite} » — items à supprimer :`, JSON.stringify(itemsAvant, null, 2));
    console.log('Réponses associées à supprimer :', JSON.stringify(reponsesAvant, null, 2));

    await bd.transaction(async (trx) => {
      const nombreReponsesSupprimees = await trx('evaluation_reponses').whereIn('question_item_id', idsASupprimer).del();
      const nombreItemsSupprimes = await trx('question_items_evaluation').whereIn('id', idsASupprimer).del();
      if (nombreItemsSupprimes !== idsASupprimer.length) {
        throw new Error(`Attendu ${idsASupprimer.length} item(s) supprimé(s), ${nombreItemsSupprimes} effectué(s) — rollback (transaction).`);
      }

      const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(trx, entite.id);
      await journalAudit.enregistrerAction(trx, {
        utilisateurId: utilisateurSysteme?.id ?? null,
        entiteId: entite.id,
        action: 'question_items_evaluation_suppression_doublon_debutant_vocabulaire',
        tableCible: 'question_items_evaluation',
        cibleId: idsASupprimer[0],
        donnees: {
          itemsSupprimes: itemsAvant,
          reponsesSupprimees: reponsesAvant,
          nombreReponsesSupprimees,
          motif:
            'Retrait de "DEBUTANT(E)" du bloc "Connaissance du vocabulaire hôtelier" (audit 2026-09-19, ' +
            'demande utilisateur) : doublon avec la question autonome dédiée "debutant" (type oui_non), ' +
            'repositionnée juste avant "Process de nettoyage" le même jour. Cet item, retiré de ' +
            "seedQuestionnairesEvaluation.js, restait orphelin en base (le seed ne supprime jamais, " +
            "additif/mise à jour seulement). Décision utilisateur, après confirmation explicite du nombre " +
            `de réponses concernées (${reponsesAvant.length} au total pour « ${codeEntite} ») : suppression ` +
            'définitive plutôt que conservation, ces réponses journalisées ci-dessus avant suppression.',
        },
      });
    });

    console.log(`\n${idsASupprimer.length} item(s) supprimé(s), ${reponsesAvant.length} réponse(s) associée(s) supprimée(s) pour « ${codeEntite} » ✔`);
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2] ?? 'accecit';
main(codeEntite).catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
