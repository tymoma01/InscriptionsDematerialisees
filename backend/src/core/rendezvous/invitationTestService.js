const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');
const { genererIcsInvitationTest, composerAdresseCourte, DUREE_TEST_MINUTES, LIEU_TEST_ACCECIT } = require('../../integrations/notifications/generateurIcs');
const { echapperHtml, formaterLignesLieuHtml, construireLienEvaluation } = require('../../integrations/notifications/formatageEmail');
const { FRONTEND_URL } = require('../../config/env');

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
});

// Date seule / heure seule (audit 2026-08-28, textes "replanifié"/"annulé" ci-dessous) — distincts
// de FORMAT_DATE_HEURE ci-dessus (les deux combinés en une seule chaîne) : ces textes ont besoin de
// composer "{date} de {heure début} à {heure fin}", donc de la date et des deux heures séparément.
const FORMAT_DATE_SEULE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' });
const FORMAT_HEURE_SEULE = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'Europe/Paris' });

// "{date} de {heure début} à {heure fin}" — même durée que l'.ics (DUREE_TEST_MINUTES,
// generateurIcs.js) pour que l'heure de fin annoncée dans le texte corresponde exactement à celle
// du rendez-vous réellement bloqué sur le calendrier Outlook.
function formaterCreneau(dateHeureIso) {
  const debut = new Date(dateHeureIso);
  const fin = new Date(debut.getTime() + DUREE_TEST_MINUTES * 60_000);
  return `${FORMAT_DATE_SEULE.format(debut)} de ${FORMAT_HEURE_SEULE.format(debut)} à ${FORMAT_HEURE_SEULE.format(fin)}`;
}

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
      // Coordonnées ACCECIT déjà affichées dans le footer de l'app (PiedDePageFormulaire.jsx /
      // PiedDePageAccecit.jsx) — simple information de contact, pas une alerte : bleu ACCECIT
      // (--couleur-primaire, styles/variables.css) plutôt qu'une couleur d'alerte type rouge/orange.
      '<p style="color: #2d3c92;">En cas de besoin, vous pouvez nous contacter au ' +
      '01 56 56 69 56 (47 avenue Paul Vaillant Couturier, 94250 Gentilly).</p>' +
      '<p>Vous trouverez en pièce jointe une invitation à ajouter directement à votre calendrier (Outlook, Google Calendar...).</p>' +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// `instructions` volontairement exclu ici (voir formatageEmail.formaterLignesLieuHtml,
// inclureInstructions: false) : ce sont des consignes d'accueil destinées au candidat qui se
// présente sur place ("munissez-vous de votre pièce d'identité", "sonnez et dites TEST"), sans
// objet pour le formateur/inspecteur qui les évalue — seul metroAcces reste utile aux deux.
// `ancienneDateHeure` (audit 2026-08-28, consolidation de la notification formateur) : présente
// uniquement pour une REPLANIFICATION (voir rendezvousService.creerRendezvous, `ancienRendezVous`
// sur le rendez-vous transmis à envoyerInvitationTest ci-dessous) — remplace le paragraphe
// "Vous êtes assigné(e)..." par un texte qui mentionne EXPLICITEMENT les deux créneaux. Avant ce
// correctif, une replanification envoyait ce même email "Nouveau candidat à évaluer" pour le
// nouveau créneau, sans un mot sur l'ancien — combiné à l'invitation Outlook native supprimée par
// ailleurs (voir plus bas), le formateur/inspecteur n'avait alors aucun moyen de savoir QUEL
// créneau avait changé sans rouvrir son calendrier. Un seul appel d'envoi reste déclenché dans les
// deux cas (voir envoyerInvitationTest, aucun appel supplémentaire ici) — seul le TEXTE change
// selon le contexte.
function construireMessageEmailFormateur({
  formateurPrenom,
  candidatPrenom,
  candidatNom,
  dateHeure,
  ancienneDateHeure,
  lieuAdresse,
  lieuMetroAcces,
  postesSelectionnes,
  notePlanification,
  lienEvaluation,
}) {
  const nomCandidat = `${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)}`;
  // "L'évènement est présent sur votre calendrier outlook" (audit 2026-08-28, corrige le texte
  // introduit le 2026-08-26) : depuis l'intégration Microsoft Graph/Outlook, ce rendez-vous existe
  // déjà réellement sur le calendrier départemental (formation@/tertiaire2@) AVANT même l'envoi de
  // cet email — la planification elle-même s'est faite via Outlook, pas via cet email ni sa pièce
  // jointe. Tiret simple (pas cadratin), décision utilisateur du 2026-08-28.
  const paragrapheCreneau = ancienneDateHeure
    ? `<p>Le test de ${nomCandidat}, initialement prévu le ${echapperHtml(formaterCreneau(ancienneDateHeure))}, ` +
      `a été replanifié pour le ${echapperHtml(formaterCreneau(dateHeure))} - L'évènement est présent sur votre ` +
      'calendrier outlook.</p>'
    : `<p>Vous êtes assigné(e) à l'évaluation du test de ${nomCandidat}, prévu le ` +
      `${echapperHtml(FORMAT_DATE_HEURE.format(new Date(dateHeure)))} - L'évènement est présent sur votre ` +
      'calendrier outlook.</p>';
  return {
    sujet: ancienneDateHeure ? 'Test replanifié' : 'Nouveau candidat à évaluer',
    corps:
      `<p>Bonjour ${echapperHtml(formateurPrenom)},</p>` +
      paragrapheCreneau +
      // Même ligne, même source de donnée (rendezvous.postes_selectionnes) que l'email candidat
      // ci-dessus — le formateur/inspecteur doit savoir sur quel(s) poste(s) évaluer ce candidat
      // précis, qui peu(ven)t différer des postes déclarés à l'inscription.
      formaterLignePostesHtml(postesSelectionnes) +
      `<p>${formaterLignesLieuHtml({ adresse: lieuAdresse, metroAcces: lieuMetroAcces }, { inclureInstructions: false })}</p>` +
      // Après date/poste(s)/lieu (demande explicite) — réservée à cet email, voir
      // formaterLigneNoteHtml ci-dessus.
      formaterLigneNoteHtml(notePlanification) +
      // Reformulé (audit 2026-08-26, décision utilisateur) : la pièce jointe .ics est présentée
      // comme un simple rappel du rendez-vous déjà confirmé (voir ligne ci-dessus), plus comme
      // l'action qui inscrit le formateur/inspecteur. Le rendez-vous n'ajoute plus le formateur/
      // inspecteur en `attendee` sur l'événement Graph depuis l'audit 2026-08-28 (corrige une
      // double notification : l'invitation Outlook native — et son "Annulé : ..." lors d'une
      // replanification — s'ajoutait à cet email personnalisé) — cet .ics reste donc la SEULE
      // notification qui arrive dans la boîte mail du formateur/inspecteur. Contenu technique de
      // l'.ics lui-même INCHANGÉ (genererIcsInvitationTest, plus bas) — seul ce texte change,
      // toujours avec le NOUVEAU créneau (voir infos.dateHeure, envoyerInvitationTest) même pour
      // une replanification.
      '<p>Vous trouverez en pièce jointe un rappel (.ics) de ce rendez-vous, à ajouter à votre agenda personnel si besoin.</p>' +
      // Lien vers /formateur/evaluations ou /inspecteur/evaluations?rendezvousId=... (voir
      // construireLienEvaluation, formatageEmail.js) — surligne directement la ligne de ce
      // rendez-vous à l'arrivée (audit 2026-08-21, ListeEvaluationsAFaire.jsx/Evaluation.jsx).
      // Placé juste avant la formule de clôture, comme dernière information de l'email.
      `<p><a href="${echapperHtml(lienEvaluation)}">Évaluer le candidat</a></p>` +
      "<p>À bientôt,<br>\nL'équipe ACCECIT</p>",
  };
}

// Annulation SIMPLE d'un test déjà planifié (pas une replanification, voir
// construireMessageEmailFormateur ci-dessus pour ce cas) — audit 2026-08-28 : ce cas n'envoyait
// jusqu'ici AUCUN email au formateur/inspecteur (changerStatutRendezvous ne fait que mettre à jour
// `rendezvous.statut`, voir rendezvousService.js), qui découvrait l'annulation seulement en
// rouvrant son calendrier Outlook (où l'événement était de toute façon supprimé, voir
// rendezvousService.creerRendezvous — mais rien à supprimer ici puisqu'une annulation simple ne
// crée jamais de nouveau rendez-vous). Aucune pièce jointe .ics : rien à ajouter à un agenda pour
// un rendez-vous qui n'a plus lieu.
function construireMessageEmailAnnulationFormateur({ formateurPrenom, candidatPrenom, candidatNom, dateHeure }) {
  return {
    sujet: 'Test annulé',
    corps:
      `<p>Bonjour ${echapperHtml(formateurPrenom)},</p>` +
      `<p>Le test de ${echapperHtml(candidatPrenom)} ${echapperHtml(candidatNom)}, prévu le ` +
      `${echapperHtml(formaterCreneau(dateHeure))}, est annulé.</p>` +
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
      // Pilote le préfixe "Formateur "/"Inspecteur " du CN affiché au candidat dans l'.ics (voir
      // generateurIcs.libelleRoleFormateur) — déjà résolu par trouverUtilisateurParId (jointure
      // roles), même donnée que celle réutilisée plus bas pour construireLienEvaluation.
      formateurRoleCode: formateur?.role_code,
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
          // Présent uniquement pour une replanification (voir rendezvousService.creerRendezvous,
          // qui ajoute `ancienRendezVous` au rendez-vous retourné SEULEMENT quand un rendez-vous
          // 'test' actif préexistait) — undefined pour une planification initiale, auquel cas
          // construireMessageEmailFormateur retombe sur le texte "Nouveau candidat à évaluer".
          ancienneDateHeure: rendezvous.ancienRendezVous?.date_heure,
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

// Annulation SIMPLE d'un rendez-vous de test déjà planifié — PAS une replanification (voir
// envoyerInvitationTest ci-dessus, qui gère déjà ce second cas via `rendezvous.ancienRendezVous`).
// Appelée depuis rendezvous.routes.js (PATCH /:rendezvousId) juste après que
// rendezvousService.changerStatutRendezvous ait bien fait passer le rendez-vous à 'annule' — best-
// effort, même principe que envoyerInvitationTest (jamais dans la transaction, un échec d'envoi ne
// remet jamais en cause l'annulation elle-même déjà actée en base). Formateur/inspecteur
// uniquement : le candidat n'a pas de compte/évaluation à consulter à ce stade, aucun lien à lui
// envoyer, et sa propre notification d'annulation est hors périmètre de cet audit (2026-08-28).
async function envoyerNotificationAnnulationTest(entite, rendezvousAnnule) {
  if (!entite.sms_actif) {
    return { formateurEmailEnvoye: false, desactive: true };
  }
  if (!rendezvousAnnule.formateur_id) {
    return { formateurEmailEnvoye: false };
  }

  const bd = await db.obtenirKnex();
  const [dossier, formateur] = await Promise.all([
    dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, rendezvousAnnule.dossier_id),
    utilisateurRepository.trouverUtilisateurParId(bd, entite.id, rendezvousAnnule.formateur_id),
  ]);

  if (!formateur?.email) {
    console.error(
      `Notification d'annulation ignorée pour le rendez-vous ${rendezvousAnnule.id} : pas d'email renseigné pour le formateur.`,
    );
    return { formateurEmailEnvoye: false };
  }

  const notificationProvider = notificationFactory();
  let formateurEmailEnvoye = false;
  try {
    const { sujet, corps } = construireMessageEmailAnnulationFormateur({
      formateurPrenom: formateur.prenom,
      candidatPrenom: dossier?.candidat_prenom,
      candidatNom: dossier?.candidat_nom,
      dateHeure: rendezvousAnnule.date_heure,
    });
    await notificationProvider.envoyer(formateur.email, 'email', corps, { sujet, html: true });
    formateurEmailEnvoye = true;
  } catch (erreur) {
    console.error(`Échec de l'envoi de l'email d'annulation pour le rendez-vous ${rendezvousAnnule.id} :`, erreur.message);
  }

  return { formateurEmailEnvoye };
}

module.exports = { envoyerInvitationTest, envoyerNotificationAnnulationTest };
