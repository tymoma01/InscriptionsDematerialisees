// Suppression définitive des 7 dossiers dont toutes les pièces justificatives sont orphelines
// (#48, #56, #57, #70, #71, #72, #82) et de toutes leurs données liées — décision actée après
// diagnostic export ZIP (dossier #82, 2026-08-06), scan complet, marquage 'orpheline' (migration
// 046, scripts/marquerPiecesOrphelines.js) et audit préalable (lecture seule, même jour). Même
// patron que scripts/purgerDossiersLegacyWorkflowV3.js (précédent direct).
//
// Audit préalable (lecture seule, mené avant d'écrire ce script) :
// - 7 candidats, chacun exclusif à l'un de ces 7 dossiers (vérifié : aucun autre dossier pour ces
//   candidat_id) — supprimés ici aussi, ce qui déclenche le CASCADE déjà en place sur
//   signatures_charte.candidat_id (migration 025).
// - 30 lignes pieces_justificatives (23 références OneDrive distinctes), TOUTES déjà marquées
//   'orpheline' — revérifiées une à une lors de l'audit (30/30 confirmées absentes côté OneDrive,
//   0 anomalie) : aucun fichier réel ne devrait rester à supprimer, mais la suppression OneDrive
//   est tentée quand même par cohérence (idempotent, un 404 est traité comme un succès par
//   azureOneDriveConnector.supprimer).
// - 39 lignes journal_audit référencent ces entités (dossiers/pieces_justificatives/
//   notes_dossier/evaluations/rendezvous) mais via `cible_id`, jamais une vraie FK —
//   volontairement NON purgées : trace d'audit RGPD conservée, même traitement que le précédent
//   nettoyage.
// - 7 lignes notes_dossier incluent les notes système posées par marquerPiecesOrphelines.js
//   (recapture demandée) — supprimées avec le reste, elles n'ont plus d'objet une fois le dossier
//   lui-même supprimé.
//
// Ordre de suppression (feuilles vers racine) : identique au précédent, aucune nouvelle table à
// FK vers dossiers/candidats/evaluations/rendezvous n'a été ajoutée depuis (vérifié sur toutes les
// migrations jusqu'à 046) :
//   evaluation_resultats -> evaluations (CASCADE sur evaluation_reponses/evaluations_postes) ->
//   relances -> rendezvous -> historique_statuts -> dossier_donnees_formulaire ->
//   pieces_justificatives -> consentements -> smartof_sync -> notes_dossier -> dossiers ->
//   candidats (signatures_charte se nettoie seul, CASCADE).
//
// Une seule transaction DB pour tout ce qui précède (rollback complet si une étape échoue). Les
// fichiers OneDrive ne sont supprimés qu'APRÈS le COMMIT, jamais à l'intérieur — même principe que
// purgerDossiersLegacyWorkflowV3.js : un appel HTTP externe non transactionnel ne doit jamais
// faire partie d'une transaction DB, et un fichier réellement supprimé chez le prestataire ne peut
// de toute façon pas être "rollback". Si un DELETE OneDrive échoue après coup, il est journalisé
// mais la suppression en base reste actée.
//
// Usage : node scripts/purgerDossiersPiecesOrphelines.js

const { obtenirKnex } = require('../src/db/knex');
const storageFactory = require('../src/integrations/stockage/storageFactory');

const DOSSIER_IDS = [48, 56, 57, 70, 71, 72, 82];

async function supprimerEnTransaction(bd) {
  const compteurs = {};
  let referencesOneDrive = [];

  await bd.transaction(async (trx) => {
    const dossiers = await trx('dossiers').whereIn('id', DOSSIER_IDS).select('id', 'candidat_id');
    if (dossiers.length !== DOSSIER_IDS.length) {
      const trouves = dossiers.map((d) => d.id);
      throw new Error(
        `Dossier(s) introuvable(s), arrêt sans rien supprimer : attendu [${DOSSIER_IDS.join(', ')}], trouvé [${trouves.join(', ')}].`,
      );
    }
    const candidatIds = dossiers.map((d) => d.candidat_id);

    const evaluations = await trx('evaluations').whereIn('dossier_id', DOSSIER_IDS).select('id');
    const evaluationIds = evaluations.map((e) => e.id);

    // 1. evaluation_resultats (pas de CASCADE depuis evaluations, contrairement à
    // evaluation_reponses/evaluations_postes qui se nettoient seuls à l'étape 2).
    compteurs.evaluation_resultats = await trx('evaluation_resultats').whereIn('evaluation_id', evaluationIds).del();

    // 2. evaluations (déclenche le CASCADE sur evaluation_reponses/evaluations_postes) — avant
    // rendezvous, puisque evaluations.rendezvous_id y fait référence.
    compteurs.evaluations = await trx('evaluations').whereIn('dossier_id', DOSSIER_IDS).del();

    // 3. relances (dossier_id direct + rendezvous_id, les deux sans CASCADE) — avant rendezvous.
    compteurs.relances = await trx('relances').whereIn('dossier_id', DOSSIER_IDS).del();

    // 4. rendezvous
    compteurs.rendezvous = await trx('rendezvous').whereIn('dossier_id', DOSSIER_IDS).del();

    // 5. historique_statuts, dossier_donnees_formulaire, pieces_justificatives (référence
    // OneDrive capturée avant suppression de la ligne), consentements, smartof_sync,
    // notes_dossier.
    compteurs.historique_statuts = await trx('historique_statuts').whereIn('dossier_id', DOSSIER_IDS).del();
    compteurs.dossier_donnees_formulaire = await trx('dossier_donnees_formulaire')
      .whereIn('dossier_id', DOSSIER_IDS)
      .del();

    const pieces = await trx('pieces_justificatives').whereIn('dossier_id', DOSSIER_IDS).select('reference_stockage');
    referencesOneDrive = pieces.map((p) => p.reference_stockage);
    compteurs.pieces_justificatives = await trx('pieces_justificatives').whereIn('dossier_id', DOSSIER_IDS).del();

    compteurs.consentements = await trx('consentements').whereIn('dossier_id', DOSSIER_IDS).del();
    compteurs.smartof_sync = await trx('smartof_sync').whereIn('dossier_id', DOSSIER_IDS).del();
    compteurs.notes_dossier = await trx('notes_dossier').whereIn('dossier_id', DOSSIER_IDS).del();

    // 6. dossiers
    compteurs.dossiers = await trx('dossiers').whereIn('id', DOSSIER_IDS).del();

    // 7. candidats (déclenche le CASCADE sur signatures_charte)
    compteurs.candidats = await trx('candidats').whereIn('id', candidatIds).del();
  });

  return { compteurs, referencesOneDrive };
}

async function supprimerFichiersOneDrive(referencesOneDrive) {
  const referencesUniques = [...new Set(referencesOneDrive)];
  console.log(
    `\n--- Suppression OneDrive : ${referencesUniques.length} fichier(s) distinct(s) pour ${referencesOneDrive.length} ligne(s) pieces_justificatives ---`,
  );
  const connecteur = storageFactory('azure_onedrive');
  let succes = 0;
  let echecs = 0;
  for (const reference of referencesUniques) {
    try {
      await connecteur.supprimer(reference);
      succes += 1;
      console.log(`  OK : ${reference}`);
    } catch (erreur) {
      echecs += 1;
      console.error(`  ÉCHEC : ${reference} — ${erreur.message}`);
    }
  }
  console.log(`\nOneDrive : ${succes} supprimé(s), ${echecs} échec(s).`);
  return echecs;
}

async function main() {
  const bd = await obtenirKnex();
  let resultat;
  try {
    resultat = await supprimerEnTransaction(bd);
  } finally {
    await bd.destroy();
  }

  console.log('--- Transaction DB validée (commit) — lignes supprimées par table ---');
  for (const [table, n] of Object.entries(resultat.compteurs)) {
    console.log(`  ${table} : ${n}`);
  }

  const echecs = await supprimerFichiersOneDrive(resultat.referencesOneDrive);
  if (echecs > 0) {
    console.error(
      "Des fichiers OneDrive n'ont pas pu être supprimés — la suppression en base est déjà actée (transaction déjà commitée), à traiter manuellement.",
    );
    process.exitCode = 1;
  }
}

main().catch((erreur) => {
  console.error('Échec de la purge ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
