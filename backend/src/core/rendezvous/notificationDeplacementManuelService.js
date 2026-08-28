// Notification "rendez-vous déplacé manuellement depuis Outlook" (voir syncCalendrierManuelService.js
// — décision utilisateur, 2026-08-28 : "si le test est déplacé, il faut envoyer un mail au
// candidat"). Fichier dédié plutôt qu'ajouté à invitationTestService.js/
// notificationChangementLieuService.js (même raisonnement que ce dernier, voir son commentaire
// d'en-tête) : ce déclencheur est un troisième cas distinct — ni une planification/replanification
// initiée depuis l'app (invitationTestService.js), ni un changement de lieu décidé par un agent
// (notificationChangementLieuService.js), mais un événement Outlook modifié directement par un
// humain EN DEHORS de l'app, détecté après coup.
//
// Candidat SEULEMENT, jamais le formateur/inspecteur (contrairement à envoyerInvitationTest, qui
// notifie les deux lors d'une replanification depuis l'app) : c'est justement un humain — le
// formateur/inspecteur assigné, ou un agent Accueil/Coordination éditant le calendrier
// départemental partagé — qui a fait ce changement à la main dans Outlook ; lui envoyer un email
// pour lui apprendre son propre geste n'aurait pas de sens, et rien ne permet ici de savoir avec
// certitude QUI a fait la modification (voir syncCalendrierManuelService.js, qui ne lit que l'état
// résultant de l'événement, jamais son historique de modification côté Graph).
//
// Pas de pièce jointe .ics (contrairement à invitationTestService.js/
// notificationChangementLieuService.js) : l'événement Outlook existe déjà et a déjà été modifié à
// la main par un humain — il n'y a rien à "pousser" côté calendrier, ce mail est une simple
// information au candidat du nouveau créneau.

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { echapperHtml } = require('../../integrations/notifications/formatageEmail');

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

function construireMessageEmail({ candidatPrenom, candidatNom, ancienneDateHeure, nouvelleDateHeure }) {
  return {
    sujet: 'Votre test ACCECIT a été déplacé',
    corps:
      `<p>Bonjour ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)},</p>` +
      `<p>Votre test, initialement prévu le ${echapperHtml(FORMAT_DATE_HEURE.format(new Date(ancienneDateHeure)))}, ` +
      `a été déplacé. Il aura désormais lieu le ${echapperHtml(FORMAT_DATE_HEURE.format(new Date(nouvelleDateHeure)))}.</p>` +
      // Même paragraphe de contact que invitationTestService.construireMessageEmail — cohérence
      // visuelle/de contenu avec la convocation initiale que le candidat a déjà reçue.
      '<p style="color: #2d3c92;">En cas de besoin, vous pouvez nous contacter au ' +
      '01 56 56 69 56 (47 avenue Paul Vaillant Couturier, 94250 Gentilly).</p>' +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// best-effort, jamais dans la transaction qui a déjà acté le nouveau date_heure en base (voir
// syncCalendrierManuelService.js) — même principe que invitationTestService.js/
// notificationChangementLieuService.js : un échec d'envoi ne doit jamais remettre en cause une
// synchronisation déjà actée. Gate sur entite.sms_actif : même convention que les autres services
// de notification de ce module — c'est l'interrupteur général notifications de l'entité, pas un
// réglage spécifique au SMS malgré son nom.
async function envoyerNotificationDeplacementManuel(entite, { dossierId, ancienneDateHeure, nouvelleDateHeure }) {
  if (!entite.sms_actif) {
    return { emailEnvoye: false, desactive: true };
  }

  const bd = await db.obtenirKnex();
  const [dossier, coordonnees] = await Promise.all([
    dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId),
    dossierRepository.trouverCoordonneesCandidat(bd, dossierId),
  ]);

  if (!coordonnees?.email) {
    console.error(`Notification de déplacement manuel ignorée pour le dossier ${dossierId} : pas d'email renseigné.`);
    return { emailEnvoye: false };
  }

  const notificationProvider = notificationFactory();
  let emailEnvoye = false;
  try {
    const { sujet, corps } = construireMessageEmail({
      candidatPrenom: dossier?.candidat_prenom,
      candidatNom: dossier?.candidat_nom,
      ancienneDateHeure,
      nouvelleDateHeure,
    });
    await notificationProvider.envoyer(coordonnees.email, 'email', corps, { sujet, html: true });
    emailEnvoye = true;
  } catch (erreur) {
    console.error(`Échec de l'envoi de l'email de déplacement manuel pour le dossier ${dossierId} :`, erreur.message);
  }

  return { emailEnvoye };
}

module.exports = { envoyerNotificationDeplacementManuel };
