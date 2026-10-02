// Synchronisation "modification manuelle Outlook" : un
// formateur/inspecteur assigné, ou un agent Accueil/Coordination, peut déplacer ou supprimer
// directement dans Outlook un événement que l'app avait créé pour un rendez-vous de test — sans
// jamais repasser par l'app elle-même. Ce module détecte ces changements, périodiquement (voir
// jobs/syncCalendrierManuelJob.js), et les répercute sur `rendezvous` en considérant l'état
// Outlook comme la vérité — jamais l'inverse : ce module ne crée ni ne recrée aucun événement
// Outlook, il ne fait que LIRE l'état actuel de ceux déjà créés par l'app (voir
// rendezvousRepository.listerRendezvousActifsAvecEvenementOutlook) et ajuster `rendezvous` en
// conséquence.
//
// "L'utilisateur a le dernier mot" (décision utilisateur) : un événement supprimé dans Outlook
// passe le rendez-vous à 'annule' ici — DÉFINITIVEMENT, jusqu'à ce qu'un agent replanifie
// explicitement depuis l'app (rendezvousService.creerRendezvous, qui crée alors un NOUVEL
// événement). Rien dans ce module ni ailleurs dans l'app ne recrée automatiquement un rendez-vous
// annulé : le seul chemin de création passe par une action explicite d'un agent, jamais par ce
// job — se reconnecter à l'app après une annulation Outlook ne "ressuscite" donc jamais le test.
//
// Réutilise rendezvousService.changerStatutRendezvous pour le cas "annulé" (même garde-fou
// STATUTS_DOSSIER_RENDEZVOUS_CLOS, même motif obligatoire que toute autre annulation) — mais PAS
// pour le cas "déplacé" (changerStatutRendezvous ne touche jamais date_heure), qui appelle
// directement rendezvousRepository.mettreAJourDateHeureRendezvous.
//
// Cas "annulé" — compose aussi la transition dossier test_planifie -> test_non_realise (audit
// 2026-09-21, corrige un angle mort constaté sur 12 dossiers PROD, ex. #29/#41 : ce module posait
// rendezvous.statut='annule' sans jamais composer avec workflowEngine.appliquerTransition, alors
// que le chemin UI équivalent — PATCH /rendezvous/:id, rendezvous.routes.js — le fait depuis le
// 2026-09-21 via rendezvousService.resoudreTransitionAnnulationTest +
// clotureRendezvousAvecTransitionService.cloturerRendezvousAvecTransition). PAS de réutilisation
// littérale de cloturerRendezvousAvecTransition ici : cette fonction ouvre TOUJOURS sa propre
// transaction (aucun bdExistante), donc l'appeler depuis l'intérieur de la transaction `trx` déjà
// ouverte plus bas casserait l'atomicité de ce module (deux transactions indépendantes au lieu
// d'une seule — exactement le risque que cloturerRendezvousAvecTransition a été créée pour
// éliminer, voir son commentaire d'en-tête). Composition inline à la place, dans la MÊME `trx` —
// même patron que basculeTestNonRealiseService.executerBasculeTestNonRealise (changerStatutRendezvous
// puis workflowEngine.appliquerTransition, tous deux passés `trx`), qui a exactement la même
// contrainte (sa propre transaction par rendez-vous, verrouillée par avance).

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const { ROLES } = require('../auth/rbac');
const graphCalendarService = require('../../integrations/calendrier/graphCalendarService');
const notificationDeplacementManuelService = require('./notificationDeplacementManuelService');
// Notification candidat + formateur/inspecteur sur annulation détectée via sync (décision
// utilisateur, 2026-09-02 — voir son commentaire au point d'appel plus bas) : même fonction,
// même texte/mécanisme que le chemin UI "Marquer annulé" (rendezvous.routes.js).
const invitationTestService = require('./invitationTestService');
const journalAudit = require('../audit/journalAudit');

const CODE_MOTIF_ANNULE_DEPUIS_OUTLOOK = 'annule_depuis_outlook';

// Second garde-fou : au-delà de ce nombre d'annulations détectées dans UN
// même passage, le job n'en applique AUCUNE et consigne une alerte — une vague d'annulations d'un
// coup signale bien plus probablement une panne (mauvaise boîte, droits retirés…) qu'une série de
// vraies suppressions manuelles. Les rendez-vous restent actifs et sont relus au passage suivant.
const SEUIL_ANNULATIONS_PAR_PASSAGE = 3;

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

// Même conversion que graphCalendarService.obtenirDisponibilites (`Prefer: outlook.timezone="UTC"`,
// dateTime renvoyé sans suffixe de fuseau, toujours interprété comme UTC ici) — reconstitue un ISO
// complet comparable directement à rendezvous.date_heure (timestamptz).
function dateOutlookVersIso(evenement) {
  return `${evenement.start.dateTime}Z`;
}

// Phase 1 — lecture de l'état Outlook d'un rendez-vous, hors transaction.
// Toujours dans la boîte où l'événement a été CRÉÉ (rendezvous.outlook_calendrier, migration 072),
// jamais dans une boîte recalculée d'après le rôle ou l'option actuelle du formateur : c'est ce qui
// annulait à tort les rendez-vous d'un formateur à calendrier personnel (événement dans sa boîte,
// lu dans formation@ -> 404). « Supprimé » UNIQUEMENT sur 404 ErrorItemNotFound dans cette boîte
// (graphCalendarService.obtenirEvenement) ; toute autre situation — boîte inconnue, autre 404, 401,
// 403, 5xx, erreur réseau — lève une erreur : jamais d'annulation sur une réponse non concluante.
async function lireEtatOutlook(rendezvous) {
  if (!rendezvous.outlook_calendrier) {
    const erreur = new Error(`Boîte de création de l'événement inconnue pour le rendez-vous ${rendezvous.id}.`);
    erreur.codeGraph = 'boite_inconnue';
    throw erreur;
  }
  const evenement = await graphCalendarService.obtenirEvenement(rendezvous.outlook_calendrier, rendezvous.outlook_event_id);
  return evenement ? { etat: 'present', evenement } : { etat: 'supprime' };
}

// Phase 2 — un seul rendez-vous, dans SA PROPRE transaction (jamais un lot entier) — un échec sur
// l'un ne doit jamais empêcher le traitement des autres, même patron que
// basculeTestNonRealiseService.executerBasculeTestNonRealise.
//
// L'appel Graph (lecture de l'état Outlook, phase 1) précède l'ouverture de la transaction, jamais l'inverse
// (même principe que rendezvousService.creerRendezvous, "Outlook D'ABORD" — mais ici en lecture, pas
// en écriture) : un appel réseau externe lent ne doit jamais garder une connexion DB ouverte.
// Relecture verrouillée (FOR UPDATE) DANS la transaction juste avant d'écrire — même rôle que
// rendezvousRepository.trouverRendezvousPourBasculeVerrouillee (déjà générique, réutilisée telle
// quelle) : revérifie que ce rendez-vous est toujours 'prevu'/'confirme' avec le MÊME
// outlook_event_id au moment précis de l'écriture, contre une action concurrente (agent qui vient
// justement de le confirmer/annuler/replanifier depuis l'app entre la lecture Graph ci-dessus et
// cette écriture) — sans ce garde-fou, ce job pourrait écraser une action déjà plus récente.
async function synchroniserRendezvous(entite, rendezvous, lecture, utilisateurSysteme) {
  const bd = await db.obtenirKnex();
  const evenement = lecture.etat === 'present' ? lecture.evenement : null;

  const resultat = await bd.transaction(async (trx) => {
    const rendezvousActuel = await rendezvousRepository.trouverRendezvousPourBasculeVerrouillee(trx, rendezvous.id);
    if (
      !rendezvousActuel ||
      !['prevu', 'confirme'].includes(rendezvousActuel.statut) ||
      rendezvousActuel.outlook_event_id !== rendezvous.outlook_event_id
    ) {
      // Déjà traité entre-temps par une action concurrente (app, ou un run précédent de ce job) —
      // rien à faire, jamais une erreur.
      return { type: 'ignore' };
    }

    if (lecture.etat === 'supprime') {
      await rendezvousService.changerStatutRendezvous(
        entite,
        {
          dossierId: rendezvous.dossier_id,
          rendezvousId: rendezvous.id,
          statut: 'annule',
          motifCode: CODE_MOTIF_ANNULE_DEPUIS_OUTLOOK,
        },
        trx,
      );

      // Compose la transition dossier (voir commentaire d'en-tête) — resoudreTransitionAnnulationTest
      // renvoie [] (jamais une erreur) si le dossier n'est plus test_planifie ou si ce n'est pas un
      // rendez-vous de type 'test' : l'annulation Outlook ci-dessus reste actée dans tous les cas,
      // que la transition s'applique ou non.
      const transitionsAnnulation = await rendezvousService.resoudreTransitionAnnulationTest(
        entite,
        { dossierId: rendezvous.dossier_id, rendezvousId: rendezvous.id },
        trx,
      );
      for (const { codeAction, commentaire } of transitionsAnnulation) {
        await workflowEngine.appliquerTransition(
          entite,
          { dossierId: rendezvous.dossier_id, codeAction, commentaire, utilisateurId: utilisateurSysteme.id, roleCode: ROLES.SYSTEME },
          trx,
        );

        // Action de journal distincte (même principe que basculeTestNonRealiseService.js et
        // rendezvous.routes.js : une action par mécanisme d'origine) — ni
        // 'dossier_transition_test_non_realise_annulation' (bouton PATCH manuel) ni
        // '..._automatique' (bascule 24h absence) : cette transition-ci part d'une annulation
        // détectée par la synchronisation Outlook, pas d'une action humaine directe dans l'app.
        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSysteme.id,
          entiteId: entite.id,
          action: 'dossier_transition_test_non_realise_annulation_sync_outlook',
          tableCible: 'historique_statuts',
          cibleId: rendezvous.dossier_id,
          donnees: { dossierId: rendezvous.dossier_id, rendezvousId: rendezvous.id, codeAction },
        });
      }

      await notesDossierRepository.ajouterNote(trx, {
        dossierId: rendezvous.dossier_id,
        auteurId: utilisateurSysteme.id,
        contenu:
          `Rendez-vous du ${FORMAT_DATE_HEURE.format(new Date(rendezvousActuel.date_heure))} annulé ` +
          'manuellement depuis le calendrier Outlook (événement supprimé en dehors de l\'app).',
      });

      await journalAudit.enregistrerAction(trx, {
        utilisateurId: utilisateurSysteme.id,
        entiteId: entite.id,
        action: 'rendezvous_annule_sync_outlook',
        tableCible: 'rendezvous',
        cibleId: rendezvous.id,
        donnees: {
          dossierId: rendezvous.dossier_id,
          outlookEventId: rendezvous.outlook_event_id,
          outlookCalendrier: rendezvous.outlook_calendrier,
        },
      });

      return { type: 'annule' };
    }

    const nouvelleDateIso = dateOutlookVersIso(evenement);
    if (new Date(nouvelleDateIso).getTime() === new Date(rendezvousActuel.date_heure).getTime()) {
      return { type: 'inchange' };
    }

    const ancienneDateIso = rendezvousActuel.date_heure;
    await rendezvousRepository.mettreAJourDateHeureRendezvous(trx, rendezvous.id, nouvelleDateIso);

    await notesDossierRepository.ajouterNote(trx, {
      dossierId: rendezvous.dossier_id,
      auteurId: utilisateurSysteme.id,
      contenu:
        `Rendez-vous déplacé manuellement depuis le calendrier Outlook : du ` +
        `${FORMAT_DATE_HEURE.format(new Date(ancienneDateIso))} au ${FORMAT_DATE_HEURE.format(new Date(nouvelleDateIso))}.`,
    });

    await journalAudit.enregistrerAction(trx, {
      utilisateurId: utilisateurSysteme.id,
      entiteId: entite.id,
      action: 'rendezvous_deplace_sync_outlook',
      tableCible: 'rendezvous',
      cibleId: rendezvous.id,
      donnees: {
        dossierId: rendezvous.dossier_id,
        outlookEventId: rendezvous.outlook_event_id,
        ancienneDate: ancienneDateIso,
        nouvelleDate: nouvelleDateIso,
      },
    });

    return { type: 'deplace', dossierId: rendezvous.dossier_id, ancienneDateIso, nouvelleDateIso };
  });

  // Notifications — best-effort, APRÈS la transaction (jamais dans la transaction déjà commitée,
  // même principe que le reste du projet, voir notificationDeplacementManuelService.js). Candidat
  // ET formateur/inspecteur pour les deux cas (décision utilisateur, 2026-09-02 : "en cas de
  // changement de planification — annulation ou déplacement — toutes les parties prenantes
  // doivent être notifiées, candidat ET Formateur/Inspecteur") — annule la règle du 2026-08-28
  // ("jamais d'email candidat pour une annulation", encore documentée jusqu'ici dans ce fichier et
  // son test) et étend celle du déplacement (candidat seul jusqu'ici) au formateur/inspecteur.
  //
  // Cas 'annule' : réutilise invitationTestService.envoyerNotificationAnnulationTest, EXACTEMENT
  // la même fonction que le chemin UI "Marquer annulé" (rendezvous.routes.js PATCH /:rendezvousId)
  // — même texte, même mécanisme best-effort par canal, sur les deux chemins qui mènent à
  // 'annule'. `rendezvous` (paramètre de cette fonction, pas `rendezvousActuel` scopé à la
  // transaction ci-dessus) porte déjà id/dossier_id/date_heure/formateur_id — aucune requête
  // supplémentaire nécessaire.
  if (resultat.type === 'annule') {
    await invitationTestService.envoyerNotificationAnnulationTest(entite, rendezvous);
  }

  if (resultat.type === 'deplace') {
    await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(entite, {
      dossierId: resultat.dossierId,
      formateurId: rendezvous.formateur_id,
      ancienneDateHeure: resultat.ancienneDateIso,
      nouvelleDateHeure: resultat.nouvelleDateIso,
    });
  }

  return resultat.type;
}

// Trace d'une lecture/application non concluante : une ligne par rendez-vous
// dans journal_audit, avec la réponse exacte (statut HTTP, code Graph) — le rendez-vous n'est PAS
// modifié et sera relu au passage suivant. Jamais bloquant : un échec d'écriture de cette trace ne
// doit pas interrompre le passage.
async function tracerErreurSync(bd, entite, utilisateurSysteme, rendezvous, erreur, phase) {
  console.error(
    `Échec de la synchronisation Outlook pour le rendez-vous ${rendezvous.id} (dossier ${rendezvous.dossier_id}) :`,
    erreur.message,
  );
  try {
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: utilisateurSysteme.id,
      entiteId: entite.id,
      action: 'rendezvous_sync_outlook_erreur',
      tableCible: 'rendezvous',
      cibleId: rendezvous.id,
      donnees: {
        phase,
        dossierId: rendezvous.dossier_id,
        outlookEventId: rendezvous.outlook_event_id,
        outlookCalendrier: rendezvous.outlook_calendrier ?? null,
        statutHttp: erreur.statusCode ?? null,
        codeGraph: erreur.codeGraph ?? null,
        erreur: erreur.message,
      },
    });
  } catch (erreurTrace) {
    console.error(`Trace de l'échec de synchronisation impossible pour le rendez-vous ${rendezvous.id} :`, erreurTrace.message);
  }
}

// Point d'entrée par entité — appelé pour toutes les entités actives par
// jobs/syncCalendrierManuelJob.js, même patron que basculeTestNonRealiseService.
// executerBasculeTestNonRealise. Une entité sans rendez-vous actif référencé sur Outlook (aucune
// intégration calendrier configurée) obtient simplement 0 rendez-vous à
// vérifier via listerRendezvousActifsAvecEvenementOutlook, sans cas particulier à gérer ici.
//
// Deux phases : lecture de TOUS les événements d'abord (lireEtatOutlook),
// puis application — ce qui permet de compter les annulations du passage AVANT d'en appliquer une
// seule (garde-fou SEUIL_ANNULATIONS_PAR_PASSAGE). Au-delà du seuil : aucune annulation, une alerte
// dans journal_audit ; les déplacements, eux, restent appliqués.
async function executerSyncCalendrierManuel(entite) {
  const bd = await db.obtenirKnex();

  const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
  if (!utilisateurSysteme) {
    throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » (voir scripts/seedUtilisateurSysteme.js).`);
  }

  const rendezvousActifs = await rendezvousRepository.listerRendezvousActifsAvecEvenementOutlook(bd, entite.id);

  let annules = 0;
  let deplaces = 0;
  let inchanges = 0;
  let ignores = 0;
  let echecs = 0;

  // Phase 1 — lectures.
  const lectures = [];
  for (const rendezvous of rendezvousActifs) {
    try {
      lectures.push({ rendezvous, lecture: await lireEtatOutlook(rendezvous) });
    } catch (erreur) {
      echecs += 1;
      await tracerErreurSync(bd, entite, utilisateurSysteme, rendezvous, erreur, 'lecture');
    }
  }

  // Garde-fou : trop d'annulations dans un même passage -> aucune.
  const aAnnuler = lectures.filter(({ lecture }) => lecture.etat === 'supprime');
  const annulationsBloquees = aAnnuler.length > SEUIL_ANNULATIONS_PAR_PASSAGE ? aAnnuler.length : 0;
  if (annulationsBloquees > 0) {
    console.error(
      `Synchronisation Outlook (${entite.code}) : ${aAnnuler.length} annulations détectées dans ce passage ` +
        `(seuil ${SEUIL_ANNULATIONS_PAR_PASSAGE}) — AUCUNE appliquée, alerte consignée.`,
    );
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: utilisateurSysteme.id,
      entiteId: entite.id,
      action: 'alerte_sync_outlook_annulations_massives',
      tableCible: 'rendezvous',
      donnees: {
        seuil: SEUIL_ANNULATIONS_PAR_PASSAGE,
        nombre: aAnnuler.length,
        rendezvous: aAnnuler.map(({ rendezvous }) => ({
          rendezvousId: rendezvous.id,
          dossierId: rendezvous.dossier_id,
          outlookCalendrier: rendezvous.outlook_calendrier,
        })),
      },
    });
  }

  // Phase 2 — application.
  for (const { rendezvous, lecture } of lectures) {
    if (lecture.etat === 'supprime' && annulationsBloquees > 0) continue;
    try {
      const type = await synchroniserRendezvous(entite, rendezvous, lecture, utilisateurSysteme);
      if (type === 'annule') annules += 1;
      else if (type === 'deplace') deplaces += 1;
      else if (type === 'inchange') inchanges += 1;
      else ignores += 1;
    } catch (erreur) {
      echecs += 1;
      await tracerErreurSync(bd, entite, utilisateurSysteme, rendezvous, erreur, 'application');
    }
  }

  return { annules, deplaces, inchanges, ignores, echecs, annulationsBloquees, total: rendezvousActifs.length };
}

module.exports = { executerSyncCalendrierManuel, CODE_MOTIF_ANNULE_DEPUIS_OUTLOOK, SEUIL_ANNULATIONS_PAR_PASSAGE };
