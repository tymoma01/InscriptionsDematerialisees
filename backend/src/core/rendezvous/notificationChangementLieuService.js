// Notification "changement de lieu" envoyée aux candidats déjà convoqués à un test, quand le lieu
// de leur rendez-vous est migré vers un autre lieu (voir lieuService.supprimerLieu — suppression
// d'un lieu encore référencé par au moins un rendez-vous, migration obligatoire). Même structure
// que invitationTestService.js (best-effort, un canal n'attend pas l'autre, jamais dans la
// transaction qui a fait la migration/suppression — voir lieuService.supprimerLieu, notifications
// envoyées après coup) : pas de fusion des deux fichiers, celui-ci reste dédié à cet unique
// événement pour ne pas alourdir invitationTestService.js d'un cas qui n'a rien à voir avec la
// planification initiale. Génération du .ics factorisée avec la convocation initiale (voir
// generateurIcs.js, seul générateur du projet) — même UID que la convocation d'origine
// (rendezvousId) + SEQUENCE incrémenté : un client calendrier (Outlook, Google Calendar) met
// alors à jour l'événement existant du candidat plutôt que d'en créer un second en doublon.

const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { genererIcsInvitationTest, composerAdresseCourte } = require('../../integrations/notifications/generateurIcs');
const { echapperHtml, formaterLignesLieuHtml } = require('../../integrations/notifications/formatageEmail');

// Toujours 1 ici : ce service ne gère qu'UN SEUL changement de lieu par rendez-vous (pas de
// compteur persistant de versions successives) — une migration ultérieure du même rendez-vous
// resterait détectée par le même UID mais écraserait ce SEQUENCE plutôt que de l'incrémenter
// encore, cas jugé assez rare pour ne pas justifier une colonne dédiée aujourd'hui.
const SEQUENCE_CHANGEMENT_LIEU = 1;

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

// adresse + metroAcces uniquement (pas `instructions`, voir formaterLignesLieuHtml ci-dessous) —
// même arbitrage que invitationTestService.construireMessageSms.
function construireMessageSms({ candidatPrenom, dateHeure, nouveauLieuAdresse, nouveauLieuMetroAcces }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  const nouveauLieu = composerAdresseCourte({ adresse: nouveauLieuAdresse, metroAcces: nouveauLieuMetroAcces });
  return `Bonjour ${candidatPrenom}, le lieu de votre test ACCECIT prévu le ${date} a changé : nouvelle adresse au ${nouveauLieu}. À bientôt !`;
}

// Corps HTML (voir graphMailProvider.js, options.html) — même principe que
// invitationTestService.construireMessageEmail : <p>/<br> explicites (un \n littéral serait
// ignoré par un client mail en HTML), et formaterLignesLieuHtml affiche les champs structurés du
// nouveau lieu (adresse/metroAcces/instructions, migration 047) chacun sur sa propre ligne. Même
// ton/structure que construireMessageEmail (invitationTestService.js) — salutation, paragraphe
// factuel, formule de clôture identique — pour rester cohérent aux yeux d'un candidat qui aurait
// déjà reçu la convocation initiale.
function construireMessageEmail({ candidatPrenom, candidatNom, dateHeure, nouveauLieuAdresse, nouveauLieuMetroAcces, nouveauLieuInstructions }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Changement de lieu pour votre test ACCECIT',
    corps:
      `<p>Bonjour ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)},</p>` +
      `<p>Le lieu de votre test prévu le ${echapperHtml(date)} a changé. Il se déroulera désormais :</p>` +
      `<p>${formaterLignesLieuHtml({ adresse: nouveauLieuAdresse, metroAcces: nouveauLieuMetroAcces, instructions: nouveauLieuInstructions })}</p>` +
      "<p>Merci de noter ce changement d'adresse.</p>" +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// Même contenu role-neutre que invitationTestService.construireMessageEmailFormateur (le
// destinataire peut être un formateur hôtel ou un inspecteur bureau, voir rendezvous.formateur_id,
// migration 018) — adapté au cas "changement de lieu" plutôt que "convocation initiale".
// `instructions` volontairement exclu (voir formatageEmail.formaterLignesLieuHtml,
// inclureInstructions: false) : consignes d'accueil destinées au candidat, sans objet pour le
// formateur/inspecteur — même arbitrage que construireMessageEmailFormateur (invitationTestService.js).
function construireMessageEmailFormateur({ formateurPrenom, candidatPrenom, candidatNom, dateHeure, nouveauLieuAdresse, nouveauLieuMetroAcces }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Changement de lieu pour un test à évaluer',
    corps:
      `<p>Bonjour ${echapperHtml(formateurPrenom)},</p>` +
      `<p>Le lieu du test de ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)}, prévu le ${echapperHtml(date)}, a changé. Il se déroulera désormais :</p>` +
      `<p>${formaterLignesLieuHtml({ adresse: nouveauLieuAdresse, metroAcces: nouveauLieuMetroAcces }, { inclureInstructions: false })}</p>` +
      "<p>Merci de noter ce changement d'adresse.</p>" +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// `rendezvous` attendu ici est déjà enrichi de candidat_nom/candidat_prenom/donnees_coordonnees
// (voir rendezvousRepository.listerRendezvousParLieu) — pas de requête supplémentaire ici,
// contrairement à envoyerInvitationTest qui part d'un rendez-vous "nu" (créé à l'instant, sans
// jointure préalable). `nouveauLieu` (objet { adresse, metroAcces, instructions }, migration 047)
// transmis tel quel par l'appelant (lieuService.supprimerLieu connaît déjà le lieu de destination,
// pas la peine de le re-résoudre ici).
//
// Gate sur entite.sms_actif : même convention que invitationTestService.js/rappelService.js/
// relanceService.js — c'est l'interrupteur général notifications de l'entité, pas un réglage
// spécifique au SMS malgré son nom (voir CLAUDE.md §3.3, config/env.js).
async function envoyerNotificationChangementLieu(entite, rendezvous, nouveauLieu) {
  if (!entite.sms_actif) {
    return { emailEnvoye: false, smsEnvoye: false, formateurEmailEnvoye: false, desactive: true };
  }

  const coordonnees = rendezvous.donnees_coordonnees;
  const infos = {
    candidatNom: rendezvous.candidat_nom,
    candidatPrenom: rendezvous.candidat_prenom,
    dateHeure: rendezvous.date_heure,
    nouveauLieuAdresse: nouveauLieu.adresse,
    nouveauLieuMetroAcces: nouveauLieu.metroAcces,
    nouveauLieuInstructions: nouveauLieu.instructions,
  };

  const notificationProvider = notificationFactory();
  let emailEnvoye = false;
  let smsEnvoye = false;

  // Email et SMS indépendants l'un de l'autre — un échec (ex. SMS : identifiants AllMySMS pas
  // encore configurés dans ce projet, voir allMySmsProvider.js) ne bloque ni ne saute l'autre
  // canal, et surtout jamais la migration/suppression déjà actée en base à ce stade : log
  // seulement, jamais de throw qui remonterait à l'appelant.
  // Généré une seule fois, réutilisé par l'email candidat ET l'email formateur/inspecteur
  // ci-dessous — même correctif que invitationTestService.js (audit 2026-08-20) : cette variable
  // était jusqu'ici scopée au seul bloc candidat, l'email formateur ne recevait donc jamais
  // l'.ics de mise à jour de lieu. Même générateur que la convocation initiale
  // (invitationTestService.js) — date/heure et participants (candidat + formateur/inspecteur
  // assigné, si déjà connu) inchangés, seul le lieu reflète la nouvelle adresse
  // (adresse+metroAcces, pas instructions — voir generateurIcs.composerAdresseCourte).
  // rendezvousId+sequence : voir SEQUENCE_CHANGEMENT_LIEU et generateurIcs.js pour le rôle exact
  // de ces deux champs (mise à jour du même événement calendrier plutôt qu'un doublon). Même
  // fichier joint pour les deux destinataires (même nom/contenu/typeMime) : c'est le même
  // événement mis à jour. try/catch dédié (createEvent, lib `ics`, peut lever une erreur) : un
  // échec de génération n'empêche ni l'email candidat ni l'email formateur de partir (sans pièce
  // jointe dans ce cas).
  let contenuIcs = null;
  try {
    contenuIcs = genererIcsInvitationTest({
      dateHeure: rendezvous.date_heure,
      candidatNom: rendezvous.candidat_nom,
      candidatPrenom: rendezvous.candidat_prenom,
      candidatEmail: coordonnees?.email,
      formateurNom: rendezvous.formateur_nom,
      formateurPrenom: rendezvous.formateur_prenom,
      formateurEmail: rendezvous.formateur_email,
      lieuAdresse: nouveauLieu.adresse,
      lieuMetroAcces: nouveauLieu.metroAcces,
      rendezvousId: rendezvous.id,
      sequence: SEQUENCE_CHANGEMENT_LIEU,
    });
  } catch (erreur) {
    console.error(`Échec de la génération de l'.ics de changement de lieu pour le rendez-vous ${rendezvous.id} :`, erreur.message);
  }
  const piecesJointesIcs = contenuIcs
    ? [{ nom: 'convocation-test-accecit.ics', contenu: Buffer.from(contenuIcs, 'utf8'), typeMime: 'text/calendar' }]
    : undefined;

  if (coordonnees?.email) {
    try {
      const { sujet, corps } = construireMessageEmail(infos);
      await notificationProvider.envoyer(coordonnees.email, 'email', corps, {
        sujet,
        html: true,
        piecesJointes: piecesJointesIcs,
      });
      emailEnvoye = true;
    } catch (erreur) {
      console.error(
        `Échec de l'envoi de l'email de changement de lieu pour le rendez-vous ${rendezvous.id} :`,
        erreur.message,
      );
    }
  } else {
    console.error(`Notification email de changement de lieu ignorée pour le rendez-vous ${rendezvous.id} : pas d'email renseigné.`);
  }

  if (coordonnees?.telephone) {
    try {
      await notificationProvider.envoyer(coordonnees.telephone, 'sms', construireMessageSms(infos));
      smsEnvoye = true;
    } catch (erreur) {
      console.error(
        `Échec de l'envoi du SMS de changement de lieu pour le rendez-vous ${rendezvous.id} :`,
        erreur.message,
      );
    }
  } else {
    console.error(`Notification SMS de changement de lieu ignorée pour le rendez-vous ${rendezvous.id} : pas de téléphone renseigné.`);
  }

  // Notification du formateur/inspecteur assigné (si déjà connu) — même best-effort indépendant
  // que les blocs candidat au-dessus, même pattern que invitationTestService.js. `rendezvous` ici
  // vient de listerRendezvousParLieu (leftJoin utilisateurs), qui ne sélectionne pas formateur_id
  // lui-même : formateur_nom sert de signal "un formateur est assigné", distinct de "il a un
  // email" (formateur_email), pour ne pas logguer une absence d'email à chaque rendez-vous qui
  // n'a simplement pas encore de formateur assigné.
  let formateurEmailEnvoye = false;
  if (rendezvous.formateur_nom) {
    if (rendezvous.formateur_email) {
      try {
        const { sujet, corps } = construireMessageEmailFormateur({ ...infos, formateurPrenom: rendezvous.formateur_prenom });
        // piecesJointes : même .ics que l'email candidat ci-dessus (audit 2026-08-20, corrige le
        // trou — cet appel n'attachait jusqu'ici jamais rien).
        await notificationProvider.envoyer(rendezvous.formateur_email, 'email', corps, {
          sujet,
          html: true,
          piecesJointes: piecesJointesIcs,
        });
        formateurEmailEnvoye = true;
      } catch (erreur) {
        console.error(
          `Échec de l'envoi de l'email de notification formateur (changement de lieu) pour le rendez-vous ${rendezvous.id} :`,
          erreur.message,
        );
      }
    } else {
      console.error(`Notification formateur de changement de lieu ignorée pour le rendez-vous ${rendezvous.id} : pas d'email renseigné pour le formateur.`);
    }
  }

  return { emailEnvoye, smsEnvoye, formateurEmailEnvoye };
}

module.exports = { envoyerNotificationChangementLieu };
