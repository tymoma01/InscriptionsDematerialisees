// Réparation ponctuelle (incident 2026-09-30/10-01) — rendez-vous de test d'Anni Neacsu annulés À TORT
// par la synchronisation Outlook (cron_sync_calendrier_manuel) : formatrice à calendrier personnel,
// événements créés dans SA boîte (adeville@accecit.com) mais relus dans formation@accecit.com ->
// 404 -> rendez-vous annulé (motif « Annulé manuellement depuis le calendrier Outlook ») et dossier
// passé en « Test non réalisé ». Les événements existent toujours dans son calendrier. Cause corrigée
// par la migration 072 (rendezvous.outlook_calendrier) et syncCalendrierManuelService.js.
//
// LISTE EXPLICITE ET FIGÉE (même principe que scripts/reparerRendezvousEvaluesRemplaces.js) : seuls
// les rendez-vous du 02/10/2026 désignés par l'utilisateur. Rien n'est sélectionné automatiquement.
const RENDEZVOUS_CIBLES = [
  122, // dossier #135
  126, // dossier #139
  135, // dossier #132
];
//
// Sécurités :
// - REFUS si la colonne rendezvous.outlook_calendrier (migration 072) n'existe pas : le correctif
//   n'est pas déployé, la synchronisation ré-annulerait aussitôt ces rendez-vous.
// - Un rendez-vous n'est traité que s'il est 'annule' AVEC le motif annule_depuis_outlook, qu'une
//   annulation par la synchronisation est tracée dans journal_audit, que son dossier est toujours
//   « Test non réalisé » et qu'aucun rendez-vous de test plus récent n'existe sur ce dossier.
// - AVANT toute écriture : lecture Graph (GET uniquement) de l'événement dans SA boîte enregistrée —
//   il doit exister, ne pas être annulé, et être au même horaire que le rendez-vous. Sinon, ce
//   rendez-vous n'est pas touché et le cas est signalé.
// - Écriture dans UNE transaction (tout ou rien), état relu sous verrou au moment d'écrire.
// - Aucun courriel, aucun SMS (aucun module de notification n'est chargé ici), et aucun événement
//   Outlook créé, modifié ou supprimé (seulement lu).
//
// Pour chaque rendez-vous rétabli : rendez-vous 'prevu' et motif retiré ; dossier « Test planifié »
// (nouvelle ligne historique_statuts au nom du compte système — le trigger de la migration 010
// répercute le statut sur dossiers.statut_id ; pas de transition du moteur, réservée à Accueil/Admin
// et sans objet pour une réparation) ; une ligne journal_audit dédiée ; une note sur le dossier.
// Aucune ligne existante de journal_audit, historique_statuts ou notes n'est modifiée.
//
// Idempotent : un rendez-vous déjà rétabli (trace ACTION_JOURNAL_AUDIT présente) n'est plus repris.
//
// Usage (depuis backend/) :
//   node scripts/retablirRendezvousAnnulesSync.js               (simulation)
//   node scripts/retablirRendezvousAnnulesSync.js --appliquer   (écriture réelle)
// --cible-dev=<id> : un seul rendez-vous de test, en DEV uniquement (refusé si NODE_ENV=production).

const { obtenirKnex } = require('../src/db/knex');
const { NODE_ENV } = require('../src/config/env');
const journalAudit = require('../src/core/audit/journalAudit');
const dossierRepository = require('../src/core/dossier/dossierRepository');
const notesDossierRepository = require('../src/core/dossier/notesDossierRepository');
const graphClient = require('../src/integrations/stockage/graphClient');

const ACTION_JOURNAL_AUDIT = 'rendezvous_retabli_annulation_sync_erronee';
const RAISON_JOURNAL_AUDIT = 'annulation automatique erronée (synchronisation Outlook, calendrier personnel)';
const ADRESSE_IP_SCRIPT = 'script:retablir-rdv-annules-sync';
const CODE_MOTIF_ANNULATION_SYNC = 'annule_depuis_outlook';
const ACTION_ANNULATION_SYNC = 'rendezvous_annule_sync_outlook';

const FORMAT_JOUR = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
});

// --- Règles (pures, testées sans base) -------------------------------------------------------------

// Conditions préalables, sans Outlook. Renvoie { code: 'INTROUVABLE' | 'DEJA_TRAITE' | 'IGNORE' |
// 'A_VERIFIER_DANS_OUTLOOK', raison? }.
function verifierPrealables(contexte) {
  const { rendezvous } = contexte;
  if (!rendezvous) return { code: 'INTROUVABLE' };
  if (contexte.dejaRetabli) return { code: 'DEJA_TRAITE' };
  if (rendezvous.statut !== 'annule') return { code: 'IGNORE', raison: `statut actuel « ${rendezvous.statut} » (attendu « annule »)` };
  if (rendezvous.type_rdv !== 'test') return { code: 'IGNORE', raison: `type_rdv « ${rendezvous.type_rdv} » (attendu « test »)` };
  if (rendezvous.motif_code !== CODE_MOTIF_ANNULATION_SYNC || !contexte.dateAnnulationSync) {
    return { code: 'IGNORE', raison: "pas annulé par la synchronisation Outlook automatique" };
  }
  if (rendezvous.statut_dossier !== 'test_non_realise') {
    return { code: 'IGNORE', raison: `dossier en « ${rendezvous.statut_dossier} » (attendu « test_non_realise »)` };
  }
  if (contexte.rendezvousTestPlusRecent) return { code: 'IGNORE', raison: 'un rendez-vous de test plus récent existe sur ce dossier' };
  if (!rendezvous.outlook_calendrier || !rendezvous.outlook_event_id) {
    return { code: 'IGNORE', raison: 'boîte ou identifiant de l’événement Outlook inconnu' };
  }
  return { code: 'A_VERIFIER_DANS_OUTLOOK' };
}

// Verdict Outlook. `etat` : { etat: 'present', debutIso, annule } | { etat: 'introuvable' } |
// { etat: 'erreur', message }.
function verifierOutlook(rendezvous, lecture) {
  if (lecture.etat === 'introuvable') {
    return { code: 'IGNORE', raison: `événement introuvable dans ${rendezvous.outlook_calendrier}` };
  }
  if (lecture.etat === 'erreur') return { code: 'IGNORE', raison: `lecture Outlook impossible (${lecture.message})` };
  if (lecture.annule) return { code: 'IGNORE', raison: `événement annulé dans Outlook (${rendezvous.outlook_calendrier})` };
  if (new Date(lecture.debutIso).getTime() !== new Date(rendezvous.date_heure).getTime()) {
    return { code: 'IGNORE', raison: `horaire différent dans Outlook (${lecture.debutIso})` };
  }
  return { code: 'ELIGIBLE' };
}

function construireNote(rendezvous, dateAnnulationSync) {
  return (
    `Rendez-vous du ${FORMAT_JOUR.format(new Date(rendezvous.date_heure))} rétabli : l'annulation automatique du ` +
    `${FORMAT_DATE_HEURE.format(new Date(dateAnnulationSync)).replace(' ', ' à ')} était une erreur de synchronisation.`
  );
}

// --- Accès aux données (knex) ---------------------------------------------------------------------

function creerAccesDonnees(bd) {
  async function chargerContexte(q, rendezvousId, { verrou = false } = {}) {
    if (verrou) await q('rendezvous').where({ id: rendezvousId }).forUpdate().first();
    const rendezvous = await q('rendezvous as r')
      .join('dossiers as d', 'd.id', 'r.dossier_id')
      .join('statuts as sd', 'sd.id', 'd.statut_id')
      .leftJoin('motifs as m', 'm.id', 'r.motif_id')
      .where('r.id', rendezvousId)
      .select('r.id', 'r.dossier_id', 'r.statut', 'r.type_rdv', 'r.date_heure', 'r.outlook_event_id', 'r.outlook_calendrier',
        'm.code as motif_code', 'd.entite_id', 'sd.code as statut_dossier')
      .first();
    if (!rendezvous) return { rendezvous: null };
    // Séquentiel (jamais Promise.all) : dans une transaction, une seule connexion — pg refuse des
    // requêtes simultanées sur un même client.
    const annulation = await q('journal_audit').where({ action: ACTION_ANNULATION_SYNC, table_cible: 'rendezvous', cible_id: rendezvousId }).min('date_action as date').first();
    const retablissement = await q('journal_audit').where({ action: ACTION_JOURNAL_AUDIT, table_cible: 'rendezvous', cible_id: rendezvousId }).first('id');
    const plusRecent = await q('rendezvous').where({ dossier_id: rendezvous.dossier_id, type_rdv: 'test' }).andWhere('id', '>', rendezvousId).first('id');
    return { rendezvous, dateAnnulationSync: annulation?.date ?? null, dejaRetabli: Boolean(retablissement), rendezvousTestPlusRecent: Boolean(plusRecent) };
  }

  function accesEcriture(trx) {
    return {
      chargerContexte: (rendezvousId) => chargerContexte(trx, rendezvousId, { verrou: true }),
      async retablir({ contexte, utilisateurSystemeId, statutTestPlanifieId }) {
        const { rendezvous } = contexte;
        await trx('rendezvous').where({ id: rendezvous.id }).update({ statut: 'prevu', motif_id: null });
        await dossierRepository.enregistrerChangementStatut(trx, {
          dossierId: rendezvous.dossier_id,
          statutId: statutTestPlanifieId,
          utilisateurId: utilisateurSystemeId,
          commentaire: `Rétabli : ${RAISON_JOURNAL_AUDIT}.`,
        });
        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSystemeId,
          entiteId: rendezvous.entite_id,
          action: ACTION_JOURNAL_AUDIT,
          tableCible: 'rendezvous',
          cibleId: rendezvous.id,
          donnees: {
            dossierId: rendezvous.dossier_id,
            statutAvant: 'annule',
            statutApres: 'prevu',
            statutDossierAvant: 'test_non_realise',
            statutDossierApres: 'test_planifie',
            motifRetire: CODE_MOTIF_ANNULATION_SYNC,
            outlookCalendrier: rendezvous.outlook_calendrier,
            outlookEventId: rendezvous.outlook_event_id,
            dateAnnulationSync: contexte.dateAnnulationSync,
            raison: RAISON_JOURNAL_AUDIT,
          },
          adresseIp: ADRESSE_IP_SCRIPT,
        });
        await notesDossierRepository.ajouterNote(trx, {
          dossierId: rendezvous.dossier_id,
          auteurId: utilisateurSystemeId,
          contenu: construireNote(rendezvous, contexte.dateAnnulationSync),
        });
      },
    };
  }

  return {
    colonneBoiteExiste: () => bd.schema.hasColumn('rendezvous', 'outlook_calendrier'),
    chargerContexte: (rendezvousId) => chargerContexte(bd, rendezvousId),
    async resoudreUtilisateurSysteme(entiteId) {
      return (await dossierRepository.trouverUtilisateurSysteme(bd, entiteId))?.id ?? null;
    },
    async resoudreStatutId(entiteId, code) {
      return (await bd('statuts').where({ entite_id: entiteId, code }).first('id'))?.id ?? null;
    },
    enTransaction: (fn) => bd.transaction((trx) => fn(accesEcriture(trx))),
  };
}

// Lecture Graph (GET uniquement) de l'événement dans SA boîte enregistrée.
async function lireEvenementOutlook(boite, outlookEventId) {
  const client = await graphClient.obtenirClientGraph();
  try {
    const evenement = await client
      .api(`/users/${boite}/events/${outlookEventId}`)
      .header('Prefer', 'outlook.timezone="UTC"')
      .select('start,isCancelled')
      .get();
    return { etat: 'present', debutIso: `${evenement.start.dateTime}Z`, annule: evenement.isCancelled === true };
  } catch (erreur) {
    if (erreur?.statusCode === 404 && erreur?.code === 'ErrorItemNotFound') return { etat: 'introuvable' };
    return { etat: 'erreur', message: `${erreur?.statusCode ?? 'réseau'} ${erreur?.code ?? ''} ${erreur?.message ?? ''}`.trim() };
  }
}

// --- Exécution (testable : accès aux données et lecture Outlook injectés) --------------------------

async function executerRetablissement({ acces, lireEvenement, appliquer, cibles, sortie = console }) {
  if (!(await acces.colonneBoiteExiste())) {
    sortie.error(
      'REFUS : la colonne rendezvous.outlook_calendrier (migration 072) est absente — le correctif de la ' +
        'synchronisation Outlook n’est pas encore déployé. Rien n’a été lu dans Outlook ni écrit. Relancer après le déploiement.',
    );
    return { refuse: true, eligibles: [], appliques: 0 };
  }

  sortie.log(appliquer ? '=== MODE APPLICATION — écriture réelle ===' : '=== MODE SIMULATION — aucune écriture (relancer avec --appliquer pour appliquer) ===');

  const eligibles = [];
  for (const rendezvousId of cibles) {
     
    const contexte = await acces.chargerContexte(rendezvousId);
    let decision = verifierPrealables(contexte);
    if (decision.code === 'A_VERIFIER_DANS_OUTLOOK') {
       
      const lecture = await lireEvenement(contexte.rendezvous.outlook_calendrier, contexte.rendezvous.outlook_event_id);
      decision = verifierOutlook(contexte.rendezvous, lecture);
    }
    const libelle = contexte.rendezvous ? `Rendez-vous #${rendezvousId} (dossier #${contexte.rendezvous.dossier_id})` : `Rendez-vous #${rendezvousId}`;
    if (decision.code === 'INTROUVABLE') sortie.log(`${libelle} : introuvable — ignoré.`);
    else if (decision.code === 'DEJA_TRAITE') sortie.log(`${libelle} : déjà rétabli — rien à faire.`);
    else if (decision.code === 'IGNORE') sortie.log(`${libelle} : NON TRAITÉ — ${decision.raison}.`);
    else {
      eligibles.push(contexte);
      sortie.log(
        `${libelle} : événement présent et non annulé dans ${contexte.rendezvous.outlook_calendrier} — ` +
          `${appliquer ? 'sera rétabli' : 'SERAIT rétabli'} (rendez-vous « annule » -> « prevu », dossier « test_non_realise » -> « test_planifie »).`,
      );
    }
  }

  // Compte système et statut cible résolus AVANT toute transaction, en simulation comme en application.
  const parEntite = new Map();
  for (const entiteId of new Set(eligibles.map((c) => c.rendezvous.entite_id))) {
     
    const utilisateurSystemeId = await acces.resoudreUtilisateurSysteme(entiteId);
     
    const statutTestPlanifieId = await acces.resoudreStatutId(entiteId, 'test_planifie');
    parEntite.set(entiteId, { utilisateurSystemeId, statutTestPlanifieId });
    if (!utilisateurSystemeId || !statutTestPlanifieId) sortie.error(`Entité #${entiteId} : compte système ou statut « test_planifie » introuvable.`);
  }
  const resolutionEnEchec = [...parEntite.values()].some((e) => !e.utilisateurSystemeId || !e.statutTestPlanifieId);

  if (!appliquer) {
    sortie.log(`\nSimulation terminée : ${eligibles.length}/${cibles.length} rendez-vous seraient rétablis. Aucun courriel ni SMS ne serait envoyé.`);
    return { refuse: false, eligibles, appliques: 0 };
  }
  if (eligibles.length === 0) {
    sortie.log('\nAucun rendez-vous à rétablir — rien à appliquer.');
    return { refuse: false, eligibles, appliques: 0 };
  }
  if (resolutionEnEchec) {
    sortie.error('\nArrêt : aucune transaction ouverte, aucune écriture effectuée.');
    return { refuse: true, eligibles, appliques: 0 };
  }

  let appliques = 0;
  await acces.enTransaction(async (ecriture) => {
    for (const { rendezvous } of eligibles) {
       
      const contexteActuel = await ecriture.chargerContexte(rendezvous.id);
      if (verifierPrealables(contexteActuel).code !== 'A_VERIFIER_DANS_OUTLOOK') {
        sortie.log(`Rendez-vous #${rendezvous.id} : état changé depuis la vérification — ignoré au moment d'écrire.`);
         
        continue;
      }
       
      await ecriture.retablir({ contexte: contexteActuel, ...parEntite.get(contexteActuel.rendezvous.entite_id) });
      sortie.log(`Rendez-vous #${rendezvous.id} (dossier #${rendezvous.dossier_id}) : rétabli ✔`);
      appliques += 1;
    }
  });
  sortie.log(`\n${appliques}/${cibles.length} rendez-vous rétabli(s) ✔ — aucun courriel ni SMS envoyé, aucun événement Outlook modifié.`);
  return { refuse: false, eligibles, appliques };
}

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const argCibleDev = process.argv.find((argument) => argument.startsWith('--cible-dev='));
  if (argCibleDev && NODE_ENV === 'production') {
    console.error('Option --cible-dev= refusée : NODE_ENV=production. Cette option est réservée aux tests en DEV.');
    process.exitCode = 1;
    return;
  }
  const cibles = argCibleDev ? [Number(argCibleDev.slice('--cible-dev='.length))] : RENDEZVOUS_CIBLES;
  if (argCibleDev) console.log(`(DEV) --cible-dev= actif : rendez-vous #${cibles[0]} uniquement.`);

  const bd = await obtenirKnex();
  try {
    const resultat = await executerRetablissement({ acces: creerAccesDonnees(bd), lireEvenement: lireEvenementOutlook, appliquer, cibles });
    if (resultat.refuse) process.exitCode = 1;
  } finally {
    await bd.destroy();
  }
}

module.exports = {
  RENDEZVOUS_CIBLES,
  ACTION_JOURNAL_AUDIT,
  RAISON_JOURNAL_AUDIT,
  verifierPrealables,
  verifierOutlook,
  construireNote,
  executerRetablissement,
  // Exposés pour la vérification en DEV (accès knex réel dans une transaction annulée).
  creerAccesDonnees,
  lireEvenementOutlook,
};

if (require.main === module) {
  main().catch((erreur) => {
    console.error('Échec du rétablissement ✘');
    console.error(erreur.message);
    process.exit(1);
  });
}
