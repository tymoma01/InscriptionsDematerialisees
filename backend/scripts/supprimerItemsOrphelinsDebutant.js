// Correctif ponctuel — retrait de "DEBUTANT(E)"/"Débutante" de la grille QCU (audit 2026-08-26).
//
// Cause racine : seedQuestionnairesEvaluation.js retire ces items de la config
// (femme_valet_chambre/cafetier/equipier, question "process_nettoyage") au profit d'une nouvelle
// question dédiée de type 'oui_non', mais le script de seed n'a jamais supprimé les items déjà en
// base qui disparaissent de la config (additif/mise à jour seulement, jamais de suppression) —
// laissés tels quels, ces 3 items seraient restés des lignes orphelines dans
// question_items_evaluation, encore renvoyées par listerQuestionsAvecItems et donc encore
// affichées EN DOUBLE (grille QCU + nouveau bloc Oui/Non) sur toute nouvelle évaluation.
//
// L'item equipier (id=58, 0 réponse enregistrée) a déjà été supprimé directement (aucune
// référence à préserver). Les 2 restants (femme_valet_chambre id=16, cafetier id=41) sont
// référencés par 2 réponses de l'évaluation #19 (candidat Ibrahima CHERIF, 10/08/2026,
// "non_acquis" sur les deux) — décision utilisateur (2026-08-26) : supprimer ces 2 lignes de
// réponse avec les 2 items, journalisées dans journal_audit avant suppression pour garder une
// trace de ce qui a été retiré. Le reste de l'évaluation #19 (autres réponses, verdict,
// commentaire) reste intact.
//
// Usage : node scripts/supprimerItemsOrphelinsDebutant.js

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const journalAudit = require('../src/core/audit/journalAudit');

const ITEMS_A_SUPPRIMER = [
  { id: 16, code: 'debutant', questionCode: 'process_nettoyage', posteCode: 'femme_valet_chambre' },
  { id: 41, code: 'debutante', questionCode: 'process_nettoyage', posteCode: 'cafetier' },
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
    // scripts/corrigerDoublonsRendezvousDossier88.js).
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
        action: 'question_items_evaluation_suppression_orphelins_debutant',
        tableCible: 'question_items_evaluation',
        cibleId: ITEMS_A_SUPPRIMER[0].id,
        donnees: {
          itemsSupprimes: itemsAvant,
          reponsesSupprimees: reponsesAvant,
          nombreReponsesSupprimees,
          motif:
            'Retrait de "DEBUTANT(E)"/"Débutante" de la grille QCU Acquis/Non acquis/A améliorer au profit ' +
            "d'une question dédiée de type 'oui_non' (audit 2026-08-26) — ces 2 items, retirés de " +
            'seedQuestionnairesEvaluation.js, restaient orphelins en base (le seed ne supprime jamais, ' +
            "additif/mise à jour seulement) et continuaient d'apparaître en double sur toute nouvelle " +
            'évaluation femme_valet_chambre/cafetier. Décision utilisateur : suppression définitive plutôt ' +
            "qu'un champ actif/archivé, ces 2 réponses journalisées ci-dessus avant suppression.",
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
