// Suppression définitive des 4 dossiers de fixtures QA "TESTQA" (#77, #78, #79, #80) et de toutes
// leurs données liées — décision actée après diagnostic sur le dossier #69 (2026-08-06/07) : scan
// complet de l'entité pour tout candidat dont le nom contient "TEST", ces 4 dossiers identifiés
// comme des fixtures QA (noms synthétiques décrivant chacun un cas de test — "MultiPoste",
// "CafetierGouvernant" — créés le même jour, 0 pièce justificative réelle), distincts du dossier
// #69 (celui-là présentait une véritable incohérence de données, déjà corrigée séparément — voir
// scripts/corrigerTransitionDossier69.js). Même patron que
// scripts/purgerDossiersLegacyWorkflowV3.js / scripts/purgerDossiersPiecesOrphelines.js.
//
// Audit préalable (lecture seule, mené avant d'écrire ce script) :
// - 4 candidats, chacun exclusif à l'un de ces 4 dossiers.
// - 0 ligne pieces_justificatives : aucun fichier OneDrive à supprimer pour ces dossiers.
// - 4 lignes journal_audit référencent ces entités (via `cible_id`, jamais une vraie FK) —
//   volontairement NON purgées, même traitement que les précédents nettoyages.
//
// Ordre de suppression (feuilles vers racine) : identique aux précédents, aucune nouvelle table à
// FK vers dossiers/candidats/evaluations/rendezvous n'a été ajoutée depuis :
//   evaluation_resultats -> evaluations (CASCADE sur evaluation_reponses/evaluations_postes) ->
//   relances -> rendezvous -> historique_statuts -> dossier_donnees_formulaire ->
//   pieces_justificatives -> consentements -> smartof_sync -> notes_dossier -> dossiers ->
//   candidats (signatures_charte se nettoie seul, CASCADE).
//
// Une seule transaction DB. Pas d'étape OneDrive après coup (0 pieces_justificatives pour ces
// dossiers, contrairement à purgerDossiersPiecesOrphelines.js) — inutile de solliciter le
// connecteur de stockage pour une liste de références vide.
//
// Usage : node scripts/purgerDossiersTestQA.js

const { obtenirKnex } = require('../src/db/knex');

const DOSSIER_IDS = [77, 78, 79, 80];

async function main() {
  const bd = await obtenirKnex();
  const compteurs = {};
  try {
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
