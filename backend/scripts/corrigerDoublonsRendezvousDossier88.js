// Correctif ponctuel — dossier #88 "Ibrahima CHERIF" (entité ACCECIT).
//
// Cause racine corrigée dans le code (voir rendezvousService.creerRendezvous, STATUT_REMPLACE,
// audit du 2026-08-13) : jusqu'ici, aucune transition ne neutralisait l'ancien rendez-vous actif
// d'un dossier lors d'une replanification — les deux restaient 'prevu' en parallèle. Ce script
// nettoie rétroactivement les 8 rendez-vous du dossier #88, seule instance connue de ce problème
// à ce jour (voir audit — les 5 lignes 61-65 initialement signalées comme doublons visibles dans
// /coordination/planification, plus 56 et 58 découverts en reconstituant la chronologie complète
// via journal_audit : eux aussi jamais neutralisés lors des replanifications suivantes, simplement
// invisibles comme "doublons" dans le tableau car à des dates différentes).
//
// Décision utilisateur (2026-08-13, confirmée avec l'agent Accueil/Coordination) : le rendez-vous
// réellement voulu pour ce dossier est le #64 (21/08/2026), PAS le #65 (14/08/2026) malgré sa
// création plus tardive — exception délibérée à la règle générale "le plus récemment créé
// l'emporte" (qui aurait désigné #65, seule ligne encore 'prevu' si on suivait strictement l'ordre
// de création), car sa date ne correspond pas à l'intention réelle du dossier. Périmètre complet
// retenu (pas seulement les paires visuellement identiques 61/63 et 62/65) : tout rendez-vous
// encore actif au moment où un autre a été créé pour ce même dossier doit être neutralisé, pour
// rester cohérent avec la règle désormais appliquée par le code à partir de maintenant.
//
// AUCUNE SUPPRESSION : seul `statut` change (-> STATUT_REMPLACE = 'remplace'), toutes les autres
// colonnes (date_heure, formateur_id, motif_id, lieu_id, postes_selectionnes) restent intactes —
// la traçabilité et l'historique par dossier (panneau "Historique des rendez-vous sélectionnés")
// continuent d'exposer ces 6 lignes avec leurs données d'origine, catégorisées "Replanifié"
// (categoriserStatutRendezvous ne se fie qu'à "est-ce le plus récent actif ?", jamais à la valeur
// exacte de `statut` — aucun changement nécessaire de ce côté).
//
// Usage : node scripts/corrigerDoublonsRendezvousDossier88.js

const { obtenirKnex } = require('../src/db/knex');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const journalAudit = require('../src/core/audit/journalAudit');

const DOSSIER_ID = 88;
const STATUT_REMPLACE = 'remplace'; // même valeur que rendezvousService.STATUT_REMPLACE
const IDS_A_NEUTRALISER = [56, 58, 61, 62, 63, 65];
const ID_A_CONSERVER_ACTIF = 64;

async function main() {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: 'accecit', actif: true }).first();
    if (!entite) {
      throw new Error('Entité « accecit » introuvable ou inactive.');
    }

    const avant = await bd('rendezvous')
      .where({ dossier_id: DOSSIER_ID })
      .orderBy('id')
      .select('id', 'date_heure', 'formateur_id', 'statut', 'motif_id', 'lieu_id');
    console.log(`Dossier #${DOSSIER_ID} avant correctif :`);
    console.log(JSON.stringify(avant, null, 2));

    // Garde-fou : n'agit que si l'état actuel correspond exactement à ce qui a été audité —
    // abandonne sans rien modifier si quelque chose a déjà changé entre-temps (ex. un agent a agi
    // sur l'un de ces rendez-vous via le back-office depuis l'audit).
    for (const id of IDS_A_NEUTRALISER) {
      const ligne = avant.find((r) => r.id === id);
      if (!ligne) {
        throw new Error(`Rendez-vous #${id} introuvable pour le dossier #${DOSSIER_ID} — arrêt sans rien modifier.`);
      }
      if (!['prevu', 'confirme'].includes(ligne.statut)) {
        throw new Error(
          `Rendez-vous #${id} : statut actuel "${ligne.statut}" (attendu prevu/confirme) — arrêt, l'état a peut-être déjà changé depuis l'audit.`,
        );
      }
    }
    const ligneConservee = avant.find((r) => r.id === ID_A_CONSERVER_ACTIF);
    if (!ligneConservee || ligneConservee.statut !== 'prevu') {
      throw new Error(`Rendez-vous #${ID_A_CONSERVER_ACTIF} : état inattendu (attendu "prevu") — arrêt sans rien modifier.`);
    }

    await bd.transaction(async (trx) => {
      const nombreMisAJour = await trx('rendezvous').whereIn('id', IDS_A_NEUTRALISER).update({ statut: STATUT_REMPLACE });
      if (nombreMisAJour !== IDS_A_NEUTRALISER.length) {
        throw new Error(
          `Attendu ${IDS_A_NEUTRALISER.length} ligne(s) mise(s) à jour, ${nombreMisAJour} effectuée(s) — rollback (transaction).`,
        );
      }

      const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(trx, entite.id);
      await journalAudit.enregistrerAction(trx, {
        utilisateurId: utilisateurSysteme?.id ?? null,
        entiteId: entite.id,
        action: 'rendezvous_nettoyage_doublons_retroactif',
        tableCible: 'rendezvous',
        cibleId: ID_A_CONSERVER_ACTIF,
        donnees: {
          dossierId: DOSSIER_ID,
          rendezvousNeutralises: IDS_A_NEUTRALISER,
          rendezvousConserveActif: ID_A_CONSERVER_ACTIF,
          statutApplique: STATUT_REMPLACE,
          motif:
            "Correctif ponctuel post-audit du 2026-08-13 : neutralise les rendez-vous 'prevu' jamais fermés lors de " +
            'replanifications successives du dossier, avant que la cause racine ne soit corrigée dans creerRendezvous ' +
            "(STATUT_REMPLACE). Conservation du #64 comme actif confirmée par l'agent Accueil/Coordination (pas #65, " +
            'malgré sa création plus tardive) — sa date (21/08) correspond à l\'intention réelle, contrairement à #65 (14/08).',
        },
      });
    });

    const apres = await bd('rendezvous')
      .where({ dossier_id: DOSSIER_ID })
      .orderBy('id')
      .select('id', 'date_heure', 'formateur_id', 'statut', 'motif_id', 'lieu_id');
    console.log(`\nDossier #${DOSSIER_ID} après correctif :`);
    console.log(JSON.stringify(apres, null, 2));
    console.log(`\n${IDS_A_NEUTRALISER.length} rendez-vous neutralisés (-> "${STATUT_REMPLACE}"), #${ID_A_CONSERVER_ACTIF} conservé actif ✔`);
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du correctif ✘');
  console.error(erreur.message);
  process.exitCode = 1;
});
