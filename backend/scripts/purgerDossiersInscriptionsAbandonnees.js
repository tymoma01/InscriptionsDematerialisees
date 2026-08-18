// Suppression définitive de 6 dossiers d'inscription abandonnée (#1, #2, #3, #4, #7, #11) —
// décision actée après l'audit du 2026-08-19 (compteur "Tous" de FiltresStatut) : ces dossiers
// datent tous du 16-17/07/2026, antérieurs de plusieurs jours au moteur de workflow lui-même
// (commit 18f6491, 21/07/2026) — inscriptions restées au bloc "coordonnees" (un seul, "disponibilites"
// pour #11, sans champ poste), jamais complétées, jamais reprises depuis (date_maj = date_creation).
// Basculées de "nouveau" à "en_attente_pieces" le 2026-08-19 (voir
// scripts/basculerDossiersNouveauEnAttentePieces.js) pour cohérence avec le reste du workflow,
// mais restées invisibles dans toutes les listes (aucun poste renseigné, voir filtrerDossiers.js)
// et sans aucun rendez-vous. Même patron que scripts/purgerDossiersTestQA.js /
// purgerDossiersLegacyWorkflowV3.js / purgerDossiersPiecesOrphelines.js.
//
// Audit préalable (lecture seule, mené avant d'écrire ce script, confirmé une dernière fois par
// ce script lui-même juste avant suppression — voir vérifications ci-dessous) :
// - 6 candidats, chacun exclusif à l'un de ces 6 dossiers (aucun autre dossier ne les référence).
// - 0 ligne pieces_justificatives : aucun fichier OneDrive à supprimer pour ces dossiers.
// - 0 ligne rendezvous.
// - postesHotel/postesBureau (bloc "disponibilites") vides ou absents pour les 6.
//
// Ordre de suppression (feuilles vers racine), identique aux précédents : aucune nouvelle table à
// FK vers dossiers/candidats/evaluations n'a été ajoutée depuis (revérifié le 2026-08-19 via
// information_schema, mêmes 11 tables référençant dossiers/candidats, toutes en delete_rule
// 'NO ACTION' sauf signatures_charte -> candidats en CASCADE) :
//   evaluation_resultats -> evaluations (CASCADE sur evaluation_reponses/evaluations_postes) ->
//   relances -> rendezvous -> historique_statuts -> dossier_donnees_formulaire ->
//   pieces_justificatives -> consentements -> smartof_sync -> notes_dossier -> dossiers ->
//   candidats (signatures_charte se nettoie seul, CASCADE).
//
// Une seule transaction DB (rollback automatique si une vérification ou une suppression échoue).
// Pas d'étape OneDrive après coup (0 pieces_justificatives pour ces dossiers).
//
// Usage : node scripts/purgerDossiersInscriptionsAbandonnees.js

const { obtenirKnex } = require('../src/db/knex');

const DOSSIER_IDS = [1, 2, 3, 4, 7, 11];

async function main() {
  const bd = await obtenirKnex();
  const compteurs = {};
  try {
    await bd.transaction(async (trx) => {
      const dossiers = await trx('dossiers').whereIn('id', DOSSIER_IDS).select('id', 'candidat_id', 'statut_id');
      if (dossiers.length !== DOSSIER_IDS.length) {
        const trouves = dossiers.map((d) => d.id);
        throw new Error(
          `Dossier(s) introuvable(s), arrêt sans rien supprimer : attendu [${DOSSIER_IDS.join(', ')}], trouvé [${trouves.join(', ')}].`,
        );
      }
      const candidatIds = dossiers.map((d) => d.candidat_id);

      // Revérification juste avant suppression (point 1 de la demande) — aucun poste, aucun
      // rendez-vous, aucune pièce, pour ne pas supprimer un dossier modifié depuis l'audit.
      const rendezvousExistants = await trx('rendezvous').whereIn('dossier_id', DOSSIER_IDS).select('id', 'dossier_id');
      if (rendezvousExistants.length > 0) {
        throw new Error(
          `Rendez-vous trouvé(s) pour ${JSON.stringify(rendezvousExistants.map((r) => r.dossier_id))} — arrêt sans rien supprimer, l'audit n'est plus à jour.`,
        );
      }
      const piecesExistantes = await trx('pieces_justificatives').whereIn('dossier_id', DOSSIER_IDS).select('id', 'dossier_id');
      if (piecesExistantes.length > 0) {
        throw new Error(
          `Pièce(s) justificative(s) trouvée(s) pour ${JSON.stringify(piecesExistantes.map((p) => p.dossier_id))} — arrêt sans rien supprimer, l'audit n'est plus à jour.`,
        );
      }
      const blocsDisponibilites = await trx('dossier_donnees_formulaire')
        .whereIn('dossier_id', DOSSIER_IDS)
        .where({ bloc_code: 'disponibilites' })
        .select('dossier_id', 'donnees');
      const dossierAvecPoste = blocsDisponibilites.find((bloc) => {
        const donnees = bloc.donnees ?? {};
        return (donnees.posteHotel ?? []).length > 0 || (donnees.posteBureau ?? []).length > 0;
      });
      if (dossierAvecPoste) {
        throw new Error(
          `Dossier #${dossierAvecPoste.dossier_id} a désormais un poste renseigné — arrêt sans rien supprimer, l'audit n'est plus à jour.`,
        );
      }
      console.log('Vérifications préalables OK : aucun poste, aucun rendez-vous, aucune pièce sur ces 6 dossiers.');

      const evaluations = await trx('evaluations').whereIn('dossier_id', DOSSIER_IDS).select('id');
      const evaluationIds = evaluations.map((e) => e.id);

      compteurs.evaluation_resultats = await trx('evaluation_resultats').whereIn('evaluation_id', evaluationIds).del();
      compteurs.evaluations = await trx('evaluations').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.relances = await trx('relances').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.rendezvous = await trx('rendezvous').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.historique_statuts = await trx('historique_statuts').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.dossier_donnees_formulaire = await trx('dossier_donnees_formulaire')
        .whereIn('dossier_id', DOSSIER_IDS)
        .del();
      compteurs.pieces_justificatives = await trx('pieces_justificatives').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.consentements = await trx('consentements').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.smartof_sync = await trx('smartof_sync').whereIn('dossier_id', DOSSIER_IDS).del();
      compteurs.notes_dossier = await trx('notes_dossier').whereIn('dossier_id', DOSSIER_IDS).del();

      compteurs.dossiers = await trx('dossiers').whereIn('id', DOSSIER_IDS).del();
      compteurs.candidats = await trx('candidats').whereIn('id', candidatIds).del();
    });
  } finally {
    await bd.destroy();
  }

  console.log('--- Transaction validée (commit) — lignes supprimées par table ---');
  for (const [table, n] of Object.entries(compteurs)) {
    console.log(`  ${table} : ${n}`);
  }
}

main().catch((erreur) => {
  console.error('Échec de la purge ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
