// Notification "rendez-vous déplacé manuellement depuis Outlook" (voir syncCalendrierManuelService.js
// — décision utilisateur, 2026-08-28 : "si le test est déplacé, il faut envoyer un mail au
// candidat"). Fichier dédié plutôt qu'ajouté à invitationTestService.js/
// notificationChangementLieuService.js (même raisonnement que ce dernier, voir son commentaire
// d'en-tête) : ce déclencheur est un troisième cas distinct — ni une planification/replanification
// initiée depuis l'app (invitationTestService.js), ni un changement de lieu décidé par un agent
// (notificationChangementLieuService.js), mais un événement Outlook modifié directement par un
// humain EN DEHORS de l'app, détecté après coup.
//
// Candidat ET Formateur/Inspecteur depuis le 2026-09-02 ("en cas de changement de planification,
// toutes les parties prenantes doivent être notifiées") — annule la restriction "candidat
// SEULEMENT" actée le 2026-08-28 : le formateur/inspecteur assigné n'était jusqu'ici jamais notifié
// ici, au motif qu'on ne peut pas savoir avec certitude s'il est lui-même l'auteur du déplacement
// Outlook (lui envoyer un email pour lui apprendre son propre geste n'aurait pas eu de sens). Ce
// risque d'auto-notification reste réel (toujours aucune visibilité sur QUI a fait la modification
// côté Graph, voir syncCalendrierManuelService.js), mais la nouvelle règle privilégie
// délibérément la symétrie et la fiabilité de l'information à toutes les parties prenantes plutôt
// que d'éviter ce cas précis — même arbitrage que pour le candidat lors d'une annulation détectée
// via sync (invitationTestService.envoyerNotificationAnnulationTest, même décision du 2026-09-02).
//
// Pas de pièce jointe .ics pour le candidat (contrairement à invitationTestService.js/
// notificationChangementLieuService.js) : l'événement Outlook existe déjà et a déjà été modifié à
// la main par un humain — il n'y a rien à "pousser" côté calendrier, ce mail est une simple
// information du nouveau créneau. Idem pour le formateur/inspecteur, par cohérence.

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { echapperHtml } = require('../../integrations/notifications/formatageEmail');

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

function construireMessageEmailCandidat({ candidatPrenom, candidatNom, ancienneDateHeure, nouvelleDateHeure }) {
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

// Formateur/inspecteur (ajouté 2026-09-02, voir commentaire d'en-tête) — texte volontairement
// sobre, même registre que invitationTestService.construireMessageEmailAnnulationFormateur : pas
// de lien évaluation ni de pièce jointe .ics, juste l'information du changement de créneau.
function construireMessageEmailFormateur({ formateurPrenom, candidatPrenom, candidatNom, ancienneDateHeure, nouvelleDateHeure }) {
  return {
    sujet: 'Test déplacé',
    corps:
      `<p>Bonjour ${echapperHtml(formateurPrenom)},</p>` +
      `<p>Le test de ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)}, initialement prévu le ` +
      `${echapperHtml(FORMAT_DATE_HEURE.format(new Date(ancienneDateHeure)))}, a été déplacé. Il aura désormais lieu le ` +
      `${echapperHtml(FORMAT_DATE_HEURE.format(new Date(nouvelleDateHeure)))}.</p>` +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// best-effort, jamais dans la transaction qui a déjà acté le nouveau date_heure en base (voir
// syncCalendrierManuelService.js) — même principe que invitationTestService.js/
// notificationChangementLieuService.js : un échec d'envoi ne doit jamais remettre en cause une
// synchronisation déjà actée. Chaque destinataire tenté indépendamment de l'autre (même patron que
// invitationTestService.envoyerInvitationTest/envoyerNotificationAnnulationTest) — l'échec de l'un
// n'empêche jamais la tentative de l'autre. Gate sur entite.sms_actif : même convention que les
// autres services de notification de ce module — c'est l'interrupteur général notifications de
// l'entité, pas un réglage spécifique au SMS malgré son nom. `formateurId` optionnel : absent pour
// un appelant qui ne l'aurait pas résolu, auquel cas seul le candidat est notifié (comportement
// avant ce correctif).
async function envoyerNotificationDeplacementManuel(entite, { dossierId, formateurId, ancienneDateHeure, nouvelleDateHeure }) {
  if (!entite.sms_actif) {
    return { candidatEmailEnvoye: false, formateurEmailEnvoye: false, desactive: true };
  }

  const bd = await db.obtenirKnex();
  const [dossier, coordonnees, formateur] = await Promise.all([
    dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId),
    dossierRepository.trouverCoordonneesCandidat(bd, dossierId),
    formateurId ? utilisateurRepository.trouverUtilisateurParId(bd, entite.id, formateurId) : null,
  ]);

  const notificationProvider = notificationFactory();

  let candidatEmailEnvoye = false;
  if (coordonnees?.email) {
    try {
      const { sujet, corps } = construireMessageEmailCandidat({
        candidatPrenom: dossier?.candidat_prenom,
        candidatNom: dossier?.candidat_nom,
        ancienneDateHeure,
        nouvelleDateHeure,
      });
      await notificationProvider.envoyer(coordonnees.email, 'email', corps, { sujet, html: true });
      candidatEmailEnvoye = true;
    } catch (erreur) {
      console.error(`Échec de l'envoi de l'email de déplacement manuel (candidat) pour le dossier ${dossierId} :`, erreur.message);
    }
  } else {
    console.error(`Notification de déplacement manuel ignorée pour le dossier ${dossierId} : pas d'email renseigné.`);
  }

  let formateurEmailEnvoye = false;
  if (formateur?.email) {
    try {
      const { sujet, corps } = construireMessageEmailFormateur({
        formateurPrenom: formateur.prenom,
        candidatPrenom: dossier?.candidat_prenom,
        candidatNom: dossier?.candidat_nom,
        ancienneDateHeure,
        nouvelleDateHeure,
      });
      await notificationProvider.envoyer(formateur.email, 'email', corps, { sujet, html: true });
      formateurEmailEnvoye = true;
    } catch (erreur) {
      console.error(`Échec de l'envoi de l'email de déplacement manuel (formateur) pour le dossier ${dossierId} :`, erreur.message);
    }
  } else if (formateurId) {
    console.error(`Notification de déplacement manuel (formateur) ignorée pour le dossier ${dossierId} : pas d'email renseigné.`);
  }

  return { candidatEmailEnvoye, formateurEmailEnvoye };
}

module.exports = { envoyerNotificationDeplacementManuel };
