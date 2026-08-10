const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { genererIcsInvitationTest, LIEU_TEST_ACCECIT } = require('../../integrations/notifications/generateurIcs');

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

function construireMessageSms({ candidatPrenom, dateHeure, lieu }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return `Bonjour ${candidatPrenom}, votre test ACCECIT est prévu le ${date}, au ${lieu}. À bientôt !`;
}

function construireMessageEmail({ candidatPrenom, candidatNom, dateHeure, lieu }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Convocation à votre test ACCECIT',
    corps:
      `Bonjour ${candidatPrenom} ${candidatNom},\n\n` +
      `Votre test est prévu le ${date}, au ${lieu}.\n\n` +
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
  // formateur : null si le rendez-vous n'a pas encore de formateur/inspecteur assigné
  // (rendezvous.formateur_id nullable, voir migration 018) — l'.ics est alors généré sans lui en
  // participant, voir genererIcsInvitationTest. lieuTrouve : null si aucun lieu précisé
  // (rendezvous.lieu_id nullable, voir migration 045) — repli sur LIEU_TEST_ACCECIT juste
  // en dessous.
  const [dossier, coordonnees, formateur, lieuTrouve] = await Promise.all([
    dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, rendezvous.dossier_id),
    dossierRepository.trouverCoordonneesCandidat(bd, rendezvous.dossier_id),
    rendezvous.formateur_id
      ? utilisateurRepository.trouverUtilisateurParId(bd, entite.id, rendezvous.formateur_id)
      : null,
    rendezvous.lieu_id ? lieuRepository.trouverLieuParId(bd, entite.id, rendezvous.lieu_id) : null,
  ]);

  // Résolu une seule fois ici, réutilisé pour les trois usages ci-dessous (.ics, SMS, email) —
  // plutôt que trois lookups séparés (voir infos.lieu, repris tel quel par construireMessageSms/
  // construireMessageEmail/genererIcsInvitationTest via le spread ...infos).
  const lieuLibelle = lieuTrouve?.libelle ?? LIEU_TEST_ACCECIT;

  const infos = {
    candidatNom: dossier?.candidat_nom,
    candidatPrenom: dossier?.candidat_prenom,
    dateHeure: rendezvous.date_heure,
    lieu: lieuLibelle,
  };

  const notificationProvider = notificationFactory();
  let emailEnvoye = false;
  let smsEnvoye = false;

  if (coordonnees?.email) {
    try {
      const { sujet, corps } = construireMessageEmail(infos);
      const contenuIcs = genererIcsInvitationTest({
        ...infos,
        candidatEmail: coordonnees.email,
        formateurNom: formateur?.nom,
        formateurPrenom: formateur?.prenom,
        formateurEmail: formateur?.email,
        // UID stable dérivé de rendezvous.id (voir generateurIcs.js) : c'est cette convocation
        // initiale qui pose la valeur que notificationChangementLieuService.js devra reprendre à
        // l'identique pour qu'un changement de lieu ultérieur mette à jour cet événement dans le
        // calendrier du candidat plutôt que d'en créer un second. sequence omis (première
        // version, RFC 5545 la traite comme 0 par défaut).
        rendezvousId: rendezvous.id,
      });
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
