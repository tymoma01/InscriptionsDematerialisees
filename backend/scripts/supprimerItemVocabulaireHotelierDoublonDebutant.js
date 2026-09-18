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
// ce script, ces 2 items seraient restés des lignes orphelines dans question_items_evaluation,
// encore renvoyées par listerQuestionsAvecItems et donc encore affichées.
//
// Audit préalable (DEV, 2026-09-19) : item id=24 (femme_valet_chambre, question 'vocabulaire_
// hotelier') référencé par 6 réponses ; item id=66 (equipier) référencé par 3 réponses — 9 au
// total. Décision utilisateur, après confirmation explicite du nombre de réponses concernées :
// suppression définitive de ces 2 items ET des 9 réponses associées (journalisées dans
// journal_audit avant suppression pour garder une trace de ce qui a été retiré). N'affecte PAS la
// question autonome 'debutant' (type 'oui_non') ni ses propres réponses, seul le doublon dans
// 'vocabulaire_hotelier' est concerné.
//
// Usage : node scripts/supprimerItemVocabulaireHotelierDoublonDebutant.js

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const journalAudit = require('../src/core/audit/journalAudit');

const ITEMS_A_SUPPRIMER = [
  { id: 24, code: 'debutant', questionCode: 'vocabulaire_hotelier', posteCode: 'femme_valet_chambre' },
  { id: 66, code: 'debutant', questionCode: 'vocabulaire_hotelier', posteCode: 'equipier' },
];

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit', actif: true }).first();
    if (!entite) {
      throw new Error('Entité « accecit » introuvable ou inactive.');
    }

    const itemsAvant = await bd('question_items_evaluation').whereIn('id', ITEMS_A_SUPPRIMER.map((i) => i.id));
    // Garde-fou : n'agit que si l'état actuel correspond exactement à ce qui a été audité —
    // abandonne sans rien modifier si quelque chose a déjà changé entre-temps (même patron que
    // scripts/supprimerItemsOrphelinsDebutant.js/corrigerDoublonsRendezvousDossier88.js).
    for (const attendu of ITEMS_A_SUPPRIMER) {
      const ligne = itemsAvant.find((i) => i.id === attendu.id);
      if (!ligne) {
        throw new Error(`Item id=${attendu.id} (${attendu.code}) introuvable — déjà supprimé ? Arrêt sans rien modifier.`);
      }
      if (ligne.code !== attendu.code) {
        throw new Error(`Item id=${attendu.id} : code actuel "${ligne.code}" (attendu "${attendu.code}") — arrêt, l'état a peut-être déjà changé.`);
      }
    }

    const reponsesAvant = await bd('evaluation_reponses')
      .whereIn('question_item_id', ITEMS_A_SUPPRIMER.map((i) => i.id))
      .select('id', 'evaluation_id', 'question_id', 'question_item_id', 'valeur');
    console.log('Items à supprimer :', JSON.stringify(itemsAvant, null, 2));
    console.log('Réponses associées à supprimer :', JSON.stringify(reponsesAvant, null, 2));

    await bd.transaction(async (trx) => {
      const nombreReponsesSupprimees = await trx('evaluation_reponses')
        .whereIn('question_item_id', ITEMS_A_SUPPRIMER.map((i) => i.id))
        .del();
      const nombreItemsSupprimes = await trx('question_items_evaluation')
        .whereIn('id', ITEMS_A_SUPPRIMER.map((i) => i.id))
        .del();
      if (nombreItemsSupprimes !== ITEMS_A_SUPPRIMER.length) {
        throw new Error(`Attendu ${ITEMS_A_SUPPRIMER.length} item(s) supprimé(s), ${nombreItemsSupprimes} effectué(s) — rollback (transaction).`);
      }

      const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(trx, entite.id);
      await journalAudit.enregistrerAction(trx, {
        utilisateurId: utilisateurSysteme?.id ?? null,
        entiteId: entite.id,
        action: 'question_items_evaluation_suppression_doublon_debutant_vocabulaire',
        tableCible: 'question_items_evaluation',
        cibleId: ITEMS_A_SUPPRIMER[0].id,
        donnees: {
          itemsSupprimes: itemsAvant,
          reponsesSupprimees: reponsesAvant,
          nombreReponsesSupprimees,
          motif:
            'Retrait de "DEBUTANT(E)" du bloc "Connaissance du vocabulaire hôtelier" (audit 2026-09-19, ' +
            'demande utilisateur) : doublon avec la question autonome dédiée "debutant" (type oui_non), ' +
            'repositionnée juste avant "Process de nettoyage" le même jour. Ces 2 items, retirés de ' +
            "seedQuestionnairesEvaluation.js, restaient orphelins en base (le seed ne supprime jamais, " +
            "additif/mise à jour seulement). Décision utilisateur, après confirmation explicite du nombre " +
            'de réponses concernées (9 au total) : suppression définitive plutôt que conservation, ces 9 ' +
            'réponses journalisées ci-dessus avant suppression.',
        },
      });
    });

    const itemsApres = await bd('question_items_evaluation').whereIn('id', ITEMS_A_SUPPRIMER.map((i) => i.id));
    console.log(`\n${itemsAvant.length - itemsApres.length} item(s) supprimé(s), ${reponsesAvant.length} réponse(s) associée(s) supprimée(s) ✔`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
