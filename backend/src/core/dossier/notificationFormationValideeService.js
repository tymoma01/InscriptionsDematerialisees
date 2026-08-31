const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { echapperHtml } = require('../../integrations/notifications/formatageEmail');

// Email au CANDIDAT lors de la confirmation "Formation validée" (Suivi des formations, transition
// valider_pret_embauche depuis valide_envoi_formation — voir transitions.routes.js, seul appelant)
// — décision utilisateur 2026-08-31, texte DÉFINITIF (pas un brouillon à ajuster). "Formation non
// validée" (invalider_formation) reste volontairement hors périmètre : aucun email associé pour
// l'instant, chantier séparé.
//
// Un seul point de vérité pour le sujet/corps (même patron que
// invitationTestService.construireMessageEmail/construireMessageEmailFormateur) : simple à ajuster
// si le texte doit changer plus tard, sans retoucher l'appelant.
function construireMessageEmailFormationValidee(candidatPrenom) {
  return {
    sujet: 'Formation Accecit validée – prochaine étape',
    corps:
      `<p>Bonjour ${echapperHtml(candidatPrenom)},</p>` +
      '<p>Nous avons le plaisir de vous informer que votre formation a été validée.</p>' +
      '<p>Accecit reviendra vers vous dans les prochains jours pour poursuivre le processus de recrutement.</p>' +
      "<p>D'ici là, nous vous remercions de bien vouloir rester disponible pendant une semaine à compter de la " +
      'réception de ce mail. Le délai de recrutement peut en effet prendre un peu de temps, et nous souhaitons ' +
      'pouvoir vous solliciter rapidement si une opportunité se présente pour rejoindre nos équipes.</p>' +
      "<p>N'hésitez pas à revenir vers nous si vous avez la moindre question.</p>" +
      "<p>À bientôt,<br>\nL'équipe ACCECIT<br>\n01 56 56 69 56<br>\n47 avenue Paul Vaillant Couturier, 94250 Gentilly</p>",
  };
}

// Best-effort STRICT (audit 2026-08-31, décision utilisateur explicite) : ne lève JAMAIS — un
// échec (pas d'email renseigné, notifications désactivées pour l'entité, panne du prestataire...)
// reste seulement loggé, la transition qui a déclenché cet envoi (déjà appliquée par l'appelant
// AVANT ce call, voir transitions.routes.js) ne doit jamais en dépendre. Expéditeur/prestataire :
// notificationFactory() (Microsoft Graph pour le canal 'email', voir docs/architecture-technique.md
// §3.3), même prestataire que tous les autres emails du projet — jamais nommé en dur ici (voir
// notificationFactory.js, "un grep de allmysms/graph dans core/ doit renvoyer zéro résultat").
//
// Gate entite.sms_actif : même convention que tous les autres envois de ce projet
// (invitationTestService.js et al.) — nom historique du flag (activé à l'origine pour AllMySMS
// seul), gate bien les DEUX canaux SMS et email malgré son nom, voir son commentaire d'en-tête
// ailleurs dans le projet.
async function envoyerEmailFormationValidee(entite, dossierId) {
  if (!entite.sms_actif) {
    return { emailEnvoye: false, desactive: true };
  }

  try {
    const bd = await db.obtenirKnex();
    const [dossier, coordonnees] = await Promise.all([
      dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId),
      dossierRepository.trouverCoordonneesCandidat(bd, dossierId),
    ]);

    if (!coordonnees?.email) {
      console.error(`Email "Formation validée" ignoré pour le dossier "${dossierId}" : pas d'email renseigné.`);
      return { emailEnvoye: false };
    }

    const { sujet, corps } = construireMessageEmailFormationValidee(dossier?.candidat_prenom);
    await notificationFactory().envoyer(coordonnees.email, 'email', corps, { sujet, html: true });
    return { emailEnvoye: true };
  } catch (erreur) {
    console.error(`Échec de l'envoi de l'email "Formation validée" pour le dossier "${dossierId}" :`, erreur.message);
    return { emailEnvoye: false };
  }
}

module.exports = { envoyerEmailFormationValidee, construireMessageEmailFormationValidee };
