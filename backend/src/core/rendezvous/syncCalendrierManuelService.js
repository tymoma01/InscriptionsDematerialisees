// Synchronisation "modification manuelle Outlook" (décision utilisateur, 2026-08-28) : un
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

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const graphCalendarService = require('../../integrations/calendrier/graphCalendarService');
const notificationDeplacementManuelService = require('./notificationDeplacementManuelService');
const journalAudit = require('../audit/journalAudit');

const CODE_MOTIF_ANNULE_DEPUIS_OUTLOOK = 'annule_depuis_outlook';

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

// Un seul rendez-vous, dans SA PROPRE transaction (jamais un lot entier) — un échec sur l'un ne
// doit jamais empêcher le traitement des autres, même patron que
// basculeTestNonRealiseService.executerBasculeTestNonRealise.
//
// L'appel Graph (lecture de l'état Outlook) précède l'ouverture de la transaction, jamais l'inverse
// (même principe que rendezvousService.creerRendezvous, "Outlook D'ABORD" — mais ici en lecture, pas
// en écriture) : un appel réseau externe lent ne doit jamais garder une connexion DB ouverte.
// Relecture verrouillée (FOR UPDATE) DANS la transaction juste avant d'écrire — même rôle que
// rendezvousRepository.trouverRendezvousPourBasculeVerrouillee (déjà générique, réutilisée telle
// quelle) : revérifie que ce rendez-vous est toujours 'prevu'/'confirme' avec le MÊME
// outlook_event_id au moment précis de l'écriture, contre une action concurrente (agent qui vient
// justement de le confirmer/annuler/replanifier depuis l'app entre la lecture Graph ci-dessus et
// cette écriture) — sans ce garde-fou, ce job pourrait écraser une action déjà plus récente.
async function synchroniserRendezvous(entite, rendezvous, utilisateurSysteme) {
  const bd = await db.obtenirKnex();
  const emailCalendrier = graphCalendarService.resoudreCalendrierParRole(rendezvous.formateur_role_code);
  const evenement = await graphCalendarService.obtenirEvenement(emailCalendrier, rendezvous.outlook_event_id);

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

    if (!evenement) {
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
        donnees: { dossierId: rendezvous.dossier_id, outlookEventId: rendezvous.outlook_event_id },
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

  // Email candidat — best-effort, APRÈS la transaction (jamais dans la transaction déjà commitée,
  // même principe que le reste du projet, voir notificationDeplacementManuelService.js).
  if (resultat.type === 'deplace') {
    await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(entite, {
      dossierId: resultat.dossierId,
      ancienneDateHeure: resultat.ancienneDateIso,
      nouvelleDateHeure: resultat.nouvelleDateIso,
    });
  }

  return resultat.type;
}

// Point d'entrée par entité — appelé pour toutes les entités actives par
// jobs/syncCalendrierManuelJob.js, même patron que basculeTestNonRealiseService.
// executerBasculeTestNonRealise. Une entité sans rendez-vous actif référencé sur Outlook (aucune
// intégration calendrier configurée, ex. Adaptel aujourd'hui) obtient simplement 0 rendez-vous à
// vérifier via listerRendezvousActifsAvecEvenementOutlook, sans cas particulier à gérer ici.
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

  for (const rendezvous of rendezvousActifs) {
    try {
      const type = await synchroniserRendezvous(entite, rendezvous, utilisateurSysteme);
      if (type === 'annule') annules += 1;
      else if (type === 'deplace') deplaces += 1;
      else if (type === 'inchange') inchanges += 1;
      else ignores += 1;
    } catch (erreur) {
      console.error(
        `Échec de la synchronisation Outlook pour le rendez-vous ${rendezvous.id} (dossier ${rendezvous.dossier_id}) :`,
        erreur.message,
      );
      echecs += 1;
    }
  }

  return { annules, deplaces, inchanges, ignores, echecs, total: rendezvousActifs.length };
}

module.exports = { executerSyncCalendrierManuel, CODE_MOTIF_ANNULE_DEPUIS_OUTLOOK };
