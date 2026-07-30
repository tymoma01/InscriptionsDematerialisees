const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { genererIcsInvitationTest, LIEU_TEST_ACCECIT } = require('../../integrations/notifications/generateurIcs');

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

function construireMessageSms({ candidatPrenom, dateHeure }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return `Bonjour ${candidatPrenom}, votre test ACCECIT est prévu le ${date}, au ${LIEU_TEST_ACCECIT}. À bientôt !`;
}

function construireMessageEmail({ candidatPrenom, candidatNom, dateHeure }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Convocation à votre test ACCECIT',
    corps:
      `Bonjour ${candidatPrenom} ${candidatNom},\n\n` +
      `Votre test est prévu le ${date}, au ${LIEU_TEST_ACCECIT}.\n\n` +
      "Vous trouverez en pièce jointe une invitation à ajouter directement à votre calendrier (Outlook, Google Calendar...).\n\n" +
      "À bientôt,\nL'équipe ACCECIT",
  };
}

// Envoi de la convocation (email avec .ics joint + SMS) au candidat, une fois un test planifié
// ou replanifié — best-effort, jamais dans la transaction qui a créé le rendez-vous (voir
// planificationRendezvousService.js, appelée seulement après que la transaction ait déjà validé)
// : un appel HTTP externe lent ne doit pas garder une connexion DB ouverte, et un échec d'envoi
// ne doit jamais faire disparaître un rendez-vous déjà acté. Chaque canal (email/SMS) est tenté
// indépendamment de l'autre — l'échec de l'un n'empêche pas la tentative de l'autre.
//
// email/sms via AllMySMS (notificationFactory), même prestataire que rappelService.js — y compris
// pour la pièce jointe .ics, décision actée le 2026-07-30 (voir allMySmsProvider.js : forme de
// l'API non vérifiée pour les pièces jointes, à confirmer avant la mise en production réelle).
async function envoyerInvitationTest(entite, rendezvous) {
  if (!entite.sms_actif) {
    return { emailEnvoye: false, smsEnvoye: false, desactive: true };
  }

  const bd = await db.obtenirKnex();
  const [dossier, coordonnees] = await Promise.all([
    dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, rendezvous.dossier_id),
    dossierRepository.trouverCoordonneesCandidat(bd, rendezvous.dossier_id),
  ]);

  const infos = {
    candidatNom: dossier?.candidat_nom,
    candidatPrenom: dossier?.candidat_prenom,
    dateHeure: rendezvous.date_heure,
  };

  const notificationProvider = notificationFactory();
  let emailEnvoye = false;
  let smsEnvoye = false;

  if (coordonnees?.email) {
    try {
      const { sujet, corps } = construireMessageEmail(infos);
      const contenuIcs = genererIcsInvitationTest(infos);
      await notificationProvider.envoyer(coordonnees.email, 'email', corps, {
        sujet,
        piecesJointes: [{ nom: 'convocation-test-accecit.ics', contenu: Buffer.from(contenuIcs, 'utf8'), typeMime: 'text/calendar' }],
      });
      emailEnvoye = true;
    } catch (erreur) {
      console.error(`Échec de l'envoi de l'email d'invitation pour le rendez-vous ${rendezvous.id} :`, erreur.message);
    }
  } else {
    console.error(`Invitation email ignorée pour le rendez-vous ${rendezvous.id} : pas d'email renseigné.`);
  }

  if (coordonnees?.telephone) {
    try {
      await notificationProvider.envoyer(coordonnees.telephone, 'sms', construireMessageSms(infos));
      smsEnvoye = true;
    } catch (erreur) {
      console.error(`Échec de l'envoi du SMS d'invitation pour le rendez-vous ${rendezvous.id} :`, erreur.message);
    }
  } else {
    console.error(`Invitation SMS ignorée pour le rendez-vous ${rendezvous.id} : pas de téléphone renseigné.`);
  }

  return { emailEnvoye, smsEnvoye };
}

module.exports = { envoyerInvitationTest };
