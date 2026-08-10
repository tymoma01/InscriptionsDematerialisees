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
const { genererIcsInvitationTest } = require('../../integrations/notifications/generateurIcs');

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

function construireMessageSms({ candidatPrenom, dateHeure, nouveauLieu }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return `Bonjour ${candidatPrenom}, le lieu de votre test ACCECIT prévu le ${date} a changé : nouvelle adresse au ${nouveauLieu}. À bientôt !`;
}

// Même ton/structure que construireMessageEmail (invitationTestService.js) — salutation,
// paragraphe factuel, formule de clôture identique — pour rester cohérent aux yeux d'un candidat
// qui aurait déjà reçu la convocation initiale.
function construireMessageEmail({ candidatPrenom, candidatNom, dateHeure, nouveauLieu }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Changement de lieu pour votre test ACCECIT',
    corps:
      `Bonjour ${candidatPrenom} ${candidatNom},\n\n` +
      `Le lieu de votre test prévu le ${date} a changé. Il se déroulera désormais au ${nouveauLieu}.\n\n` +
      "Merci de noter ce changement d'adresse.\n\n" +
      "À bientôt,\nL'équipe ACCECIT",
  };
}

// `rendezvous` attendu ici est déjà enrichi de candidat_nom/candidat_prenom/donnees_coordonnees
// (voir rendezvousRepository.listerRendezvousParLieu) — pas de requête supplémentaire ici,
// contrairement à envoyerInvitationTest qui part d'un rendez-vous "nu" (créé à l'instant, sans
// jointure préalable). `nouveauLieuLibelle` transmis tel quel par l'appelant (lieuService.
// supprimerLieu connaît déjà le lieu de destination, pas la peine de le re-résoudre ici).
//
// Gate sur entite.sms_actif : même convention que invitationTestService.js/rappelService.js/
// relanceService.js — c'est l'interrupteur général notifications de l'entité, pas un réglage
// spécifique au SMS malgré son nom (voir CLAUDE.md §3.3, config/env.js).
async function envoyerNotificationChangementLieu(entite, rendezvous, nouveauLieuLibelle) {
  if (!entite.sms_actif) {
    return { emailEnvoye: false, smsEnvoye: false, desactive: true };
  }

  const coordonnees = rendezvous.donnees_coordonnees;
  const infos = {
    candidatNom: rendezvous.candidat_nom,
    candidatPrenom: rendezvous.candidat_prenom,
    dateHeure: rendezvous.date_heure,
    nouveauLieu: nouveauLieuLibelle,
  };

  const notificationProvider = notificationFactory();
  let emailEnvoye = false;
  let smsEnvoye = false;

  // Email et SMS indépendants l'un de l'autre — un échec (ex. SMS : identifiants AllMySMS pas
  // encore configurés dans ce projet, voir allMySmsProvider.js) ne bloque ni ne saute l'autre
  // canal, et surtout jamais la migration/suppression déjà actée en base à ce stade : log
  // seulement, jamais de throw qui remonterait à l'appelant.
  if (coordonnees?.email) {
    try {
      const { sujet, corps } = construireMessageEmail(infos);
      // Même générateur que la convocation initiale (invitationTestService.js) — date/heure et
      // participants (candidat + formateur/inspecteur assigné, si déjà connu) inchangés, seul
      // `lieu` reflète la nouvelle adresse. rendezvousId+sequence : voir SEQUENCE_CHANGEMENT_LIEU
      // et generateurIcs.js pour le rôle exact de ces deux champs (mise à jour du même événement
      // calendrier plutôt qu'un doublon).
      const contenuIcs = genererIcsInvitationTest({
        dateHeure: rendezvous.date_heure,
        candidatNom: rendezvous.candidat_nom,
        candidatPrenom: rendezvous.candidat_prenom,
        candidatEmail: coordonnees.email,
        formateurNom: rendezvous.formateur_nom,
        formateurPrenom: rendezvous.formateur_prenom,
        formateurEmail: rendezvous.formateur_email,
        lieu: nouveauLieuLibelle,
        rendezvousId: rendezvous.id,
        sequence: SEQUENCE_CHANGEMENT_LIEU,
      });
      await notificationProvider.envoyer(coordonnees.email, 'email', corps, {
        sujet,
        piecesJointes: [{ nom: 'convocation-test-accecit.ics', contenu: Buffer.from(contenuIcs, 'utf8'), typeMime: 'text/calendar' }],
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

  return { emailEnvoye, smsEnvoye };
}

module.exports = { envoyerNotificationChangementLieu };
