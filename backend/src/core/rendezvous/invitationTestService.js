const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { genererIcsInvitationTest, composerAdresseCourte, LIEU_TEST_ACCECIT } = require('../../integrations/notifications/generateurIcs');
const { echapperHtml, formaterLignesLieuHtml, construireLienEvaluation } = require('../../integrations/notifications/formatageEmail');
const { FRONTEND_URL } = require('../../config/env');

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

// Libellés des postes, propre à cette entité (voir Modularité, CLAUDE.md) — même mapping que
// côté front (TableauDeBordAccueil.jsx/VerificationPieces.jsx/Planification.jsx/Validation.jsx),
// dupliqué plutôt que partagé (voir CLAUDE.md conventions du projet) : un code absent (poste
// ajouté au formulaire mais pas encore ici) retombe simplement sur le code brut plutôt que
// d'échouer.
const LIBELLES_POSTE_PAR_CODE_ACCECIT = {
  nettoyage: 'Nettoyage',
  vitrerie: 'Vitrerie',
  machiniste: 'Machiniste',
  chef_equipe: "Chef d'équipe",
  autres: 'Autres',
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafétier(ère)',
  equipier: 'Équipier(ère)',
  gouvernant: 'Gouvernant(e)',
};
function libellePoste(code) {
  return LIBELLES_POSTE_PAR_CODE_ACCECIT[code] ?? code;
}

// Ligne "Poste(s) : ..." commune aux deux emails ci-dessous — postes RETENUS pour CE rendez-vous
// précis (rendezvous.postes_selectionnes, migration 039), pas les postes déclarés à l'inscription
// (dossier_donnees_formulaire.donnees.posteBureau/posteHotel) : les deux peuvent différer (voir
// ModalePlanificationTest.jsx, sélection ajustable au moment de la planification). Chaîne vide
// (pas de <p>) si aucun poste retenu — rendez-vous créé avant la migration 039, ou dossier sans
// aucun poste déclaré (cas limite) : mieux vaut omettre la ligne qu'afficher "Poste(s) : " suivi
// de rien.
function formaterLignePostesHtml(postesSelectionnes = []) {
  if (postesSelectionnes.length === 0) return '';
  const libelles = postesSelectionnes.map(libellePoste).join(', ');
  return `<p>Poste(s) : ${echapperHtml(libelles)}</p>`;
}

// Note libre optionnelle saisie par l'agent au moment de la planification de CE rendez-vous
// (rendezvous.note_planification, migration 049, ModalePlanificationTest.jsx) — réservée à
// l'email formateur/inspecteur (voir construireMessageEmailFormateur, jamais construireMessageEmail
// côté candidat) : distincte du journal de notes générales du dossier (notes_dossier), jamais
// incluse ici. Chaîne vide (pas de <p>) si aucune note renseignée pour ce rendez-vous précis —
// même principe que formaterLignePostesHtml ci-dessus, pas de ligne "Note de l'agent :" vide.
function formaterLigneNoteHtml(notePlanification) {
  if (!notePlanification) return '';
  return `<p>Note de l'agent : ${echapperHtml(notePlanification)}</p>`;
}

// adresse + metroAcces uniquement (pas `instructions`, plus long et réservé à l'email HTML, voir
// formaterLignesLieuHtml) — arbitrage acté au passage aux champs structurés (migration 047).
function construireMessageSms({ candidatPrenom, dateHeure, lieuAdresse, lieuMetroAcces }) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  const lieu = composerAdresseCourte({ adresse: lieuAdresse, metroAcces: lieuMetroAcces });
  return `Bonjour ${candidatPrenom}, votre test ACCECIT est prévu le ${date}, au ${lieu}. À bientôt !`;
}

// Corps HTML (voir graphMailProvider.js, options.html) — un \n littéral serait ignoré par un
// client mail en HTML, d'où <p>/<br> explicites plutôt que la ponctuation par \n utilisée pour le
// SMS ci-dessus. formaterLignesLieuHtml affiche adresse/metroAcces/instructions (champs structurés,
// migration 047) chacun sur sa propre ligne, plutôt que de tout concaténer sur une seule ligne
// difficile à lire — seul ce canal inclut aussi `instructions` (voir construireMessageSms
// ci-dessus, plus court).
function construireMessageEmail({
  candidatPrenom,
  candidatNom,
  dateHeure,
  lieuAdresse,
  lieuMetroAcces,
  lieuInstructions,
  postesSelectionnes,
}) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Convocation à votre test ACCECIT',
    corps:
      `<p>Bonjour ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)},</p>` +
      `<p>Votre test est prévu le ${echapperHtml(date)}.</p>` +
      // Juste après la date, avant le lieu : ordre "quand / pour quel poste / où", cohérent avec
      // la lecture naturelle d'une convocation.
      formaterLignePostesHtml(postesSelectionnes) +
      `<p>${formaterLignesLieuHtml({ adresse: lieuAdresse, metroAcces: lieuMetroAcces, instructions: lieuInstructions })}</p>` +
      '<p>Vous trouverez en pièce jointe une invitation à ajouter directement à votre calendrier (Outlook, Google Calendar...).</p>' +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// `instructions` volontairement exclu ici (voir formatageEmail.formaterLignesLieuHtml,
// inclureInstructions: false) : ce sont des consignes d'accueil destinées au candidat qui se
// présente sur place ("munissez-vous de votre pièce d'identité", "sonnez et dites TEST"), sans
// objet pour le formateur/inspecteur qui les évalue — seul metroAcces reste utile aux deux.
function construireMessageEmailFormateur({
  formateurPrenom,
  candidatPrenom,
  candidatNom,
  dateHeure,
  lieuAdresse,
  lieuMetroAcces,
  postesSelectionnes,
  notePlanification,
  lienEvaluation,
}) {
  const date = FORMAT_DATE_HEURE.format(new Date(dateHeure));
  return {
    sujet: 'Nouveau candidat à évaluer',
    corps:
      `<p>Bonjour ${echapperHtml(formateurPrenom)},</p>` +
      `<p>Vous êtes assigné(e) à l'évaluation du test de ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)}, prévu le ${echapperHtml(date)}.</p>` +
      // Même ligne, même source de donnée (rendezvous.postes_selectionnes) que l'email candidat
      // ci-dessus — le formateur/inspecteur doit savoir sur quel(s) poste(s) évaluer ce candidat
      // précis, qui peu(ven)t différer des postes déclarés à l'inscription.
      formaterLignePostesHtml(postesSelectionnes) +
      `<p>${formaterLignesLieuHtml({ adresse: lieuAdresse, metroAcces: lieuMetroAcces }, { inclureInstructions: false })}</p>` +
      // Après date/poste(s)/lieu (demande explicite) — réservée à cet email, voir
      // formaterLigneNoteHtml ci-dessus.
      formaterLigneNoteHtml(notePlanification) +
      // Lien vers /formateur/evaluations ou /inspecteur/evaluations?rendezvousId=... (voir
      // construireLienEvaluation, formatageEmail.js) — surligne directement la ligne de ce
      // rendez-vous à l'arrivée (audit 2026-08-21, ListeEvaluationsAFaire.jsx/Evaluation.jsx).
      // Placé juste avant la formule de clôture, comme dernière information de l'email.
      `<p><a href="${echapperHtml(lienEvaluation)}">Voir l'évaluation de ce candidat</a></p>` +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
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
    return { emailEnvoye: false, smsEnvoye: false, formateurEmailEnvoye: false, desactive: true };
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
  // plutôt que trois lookups séparés (voir infos.lieuAdresse/lieuMetroAcces/lieuInstructions,
  // repris tels quels par construireMessageSms/construireMessageEmail/genererIcsInvitationTest via
  // le spread ...infos). Champs structurés depuis la migration 047 (remplace l'ancien `libelle`
  // texte libre) — repli sur LIEU_TEST_ACCECIT (adresse seule, pas de métro/instructions) quand
  // aucun lieu n'est précisé sur le rendez-vous.
  const infos = {
    candidatNom: dossier?.candidat_nom,
    candidatPrenom: dossier?.candidat_prenom,
    dateHeure: rendezvous.date_heure,
    lieuAdresse: lieuTrouve?.adresse ?? LIEU_TEST_ACCECIT,
    lieuMetroAcces: lieuTrouve?.metro_acces,
    lieuInstructions: lieuTrouve?.instructions,
    // Postes RETENUS pour CE rendez-vous précis (voir formaterLignePostesHtml plus haut), lu
    // directement sur la ligne `rendezvous` fraîchement créée/relue par l'appelant (voir
    // planificationRendezvousService.js) — jamais recalculé depuis les postes déclarés à
    // l'inscription du dossier, qui peuvent différer. Une replanification crée toujours un
    // nouveau rendez-vous (voir rendezvousRepository.creerRendezvous /
    // neutraliserRendezvousActifsDossier) : `rendezvous` ici est systématiquement le plus récent,
    // jamais un ancien rendez-vous remplacé.
    postesSelectionnes: rendezvous.postes_selectionnes,
  };

  const notificationProvider = notificationFactory();
  let emailEnvoye = false;
  let smsEnvoye = false;

  // Généré une seule fois, réutilisé par l'email candidat ET l'email formateur/inspecteur
  // ci-dessous — audit 2026-08-20 : cette variable était jusqu'ici scopée au seul bloc candidat
  // (try { const contenuIcs = ... }), donc inaccessible au moment de l'envoi formateur, qui ne
  // recevait jamais l'.ics. Même fichier joint pour les deux destinataires (même nom, même
  // contenu, même typeMime) : c'est le même événement, aucune raison de le personnaliser par
  // destinataire — genererIcsInvitationTest liste d'ailleurs déjà les deux comme ATTENDEE dans un
  // seul et même .ics (voir generateurIcs.js). Pure et sans effet de bord, mais createEvent (lib
  // `ics`) peut lever une erreur (date invalide...) : try/catch dédié pour qu'un échec de
  // génération n'empêche ni l'email candidat ni l'email formateur de partir (sans pièce jointe
  // dans ce cas), au lieu de faire échouer les deux comme le ferait une exception non rattrapée.
  let contenuIcs = null;
  try {
    contenuIcs = genererIcsInvitationTest({
      ...infos,
      candidatEmail: coordonnees?.email,
      formateurNom: formateur?.nom,
      formateurPrenom: formateur?.prenom,
      formateurEmail: formateur?.email,
      // UID stable dérivé de rendezvous.id (voir generateurIcs.js) : c'est cette convocation
      // initiale qui pose la valeur que notificationChangementLieuService.js devra reprendre à
      // l'identique pour qu'un changement de lieu ultérieur mette à jour cet événement dans le
      // calendrier du destinataire plutôt que d'en créer un second. sequence omis (première
      // version, RFC 5545 la traite comme 0 par défaut).
      rendezvousId: rendezvous.id,
    });
  } catch (erreur) {
    console.error(`Échec de la génération de l'.ics pour le rendez-vous ${rendezvous.id} :`, erreur.message);
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

  // Notification du formateur/inspecteur assigné (si déjà connu, voir formateur ci-dessus) —
  // même best-effort indépendant que les blocs candidat au-dessus : un échec ici ne doit ni faire
  // échouer la planification, ni empêcher les envois déjà tentés côté candidat.
  let formateurEmailEnvoye = false;
  if (formateur) {
    if (formateur.email) {
      try {
        // notePlanification passée UNIQUEMENT ici, jamais dans `infos` (partagé avec l'email
        // candidat construireMessageEmail ci-dessus) : réservée au formateur/inspecteur, voir
        // formaterLigneNoteHtml. formateur.role_code déjà disponible (trouverUtilisateurParId
        // joint roles, voir utilisateurRepository.js) : pas besoin d'une requête supplémentaire
        // pour distinguer /formateur/ de /inspecteur/ dans le lien.
        const { sujet, corps } = construireMessageEmailFormateur({
          ...infos,
          formateurPrenom: formateur.prenom,
          notePlanification: rendezvous.note_planification,
          lienEvaluation: construireLienEvaluation(FRONTEND_URL, formateur.role_code, rendezvous.id),
        });
        // piecesJointes : même .ics que l'email candidat ci-dessus (audit 2026-08-20, corrige le
        // trou — cet appel n'attachait jusqu'ici jamais rien).
        await notificationProvider.envoyer(formateur.email, 'email', corps, { sujet, html: true, piecesJointes: piecesJointesIcs });
        formateurEmailEnvoye = true;
      } catch (erreur) {
        console.error(`Échec de l'envoi de l'email de notification formateur pour le rendez-vous ${rendezvous.id} :`, erreur.message);
      }
    } else {
      console.error(`Notification formateur ignorée pour le rendez-vous ${rendezvous.id} : pas d'email renseigné pour le formateur.`);
    }
  }

  return { emailEnvoye, smsEnvoye, formateurEmailEnvoye };
}

module.exports = { envoyerInvitationTest };
