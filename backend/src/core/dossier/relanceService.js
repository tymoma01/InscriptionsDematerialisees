const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const relanceRepository = require('./relanceRepository');
const motifRepository = require('../motifs/motifRepository');
const notificationFactory = require('../../integrations/notifications/notificationFactory');

const CATEGORIE_MOTIF_RESULTAT_RELANCE = 'resultat_relance';

// Canaux universels (SMS/email via le prestataire de notification, voir integrations/notifications/,
// ou appel téléphonique par l'accueil) — pas une donnée de configuration par entité comme les
// statuts ou les types de pièces (voir Modularité, CLAUDE.md) : ce sont les seuls canaux que ce
// projet sait déclencher/enregistrer, quelle que soit l'entité. Même patron que
// STATUTS_VERIFICATION_AUTORISES dans pieceJustificativeService.js (petite énumération fixe, pas
// de table dédiée). Nom du prestataire volontairement absent de ce commentaire : core/ ne doit
// jamais nommer de prestataire concret (voir docs/architecture-technique.md §3.4).
const CANAUX_AUTORISES = ['sms', 'email', 'telephone'];

// sms/email déclenchent désormais un envoi réel (décision 2026-07-30) — 'telephone' reste un
// appel passé par l'agent hors de l'application, rien à envoyer ici.
const CANAUX_ENVOI_REEL = ['sms', 'email'];

// Résultat déterminé automatiquement par le succès/échec technique de l'envoi pour sms/email —
// plus un choix libre de l'agent comme pour 'telephone' (sans_reponse, injoignable...) : ces
// libellés décrivent l'issue d'un appel téléphonique, qui n'a plus de sens une fois que
// l'application envoie elle-même le message. Codes à amorcer pour chaque entité utilisant
// sms/email (voir scripts/seedMotifsRelance.js), même table `motifs` que les résultats "appel".
const RESULTAT_ENVOI_REUSSI = 'envoye';
const RESULTAT_ENVOI_ECHEC = 'echec_envoi';

// Messages de rappel simples, contextualisés par l'étape en cours du dossier — volontairement
// distincts de l'invitation au test (voir invitationTestService.js, qui porte la date/heure/lieu
// précis et le .ics) : une relance ne fait qu'inviter le candidat à reprendre contact/se
// présenter, sans dupliquer une donnée de rendez-vous qu'elle ne recharge pas ici.
const MESSAGES_RELANCE_PAR_STATUT = {
  en_attente_pieces: (prenom) =>
    `Bonjour ${prenom}, il vous reste des documents à déposer pour finaliser votre dossier ACCECIT. ` +
    'Merci de vous présenter à l’accueil dès que possible.',
  test_planifie: (prenom) =>
    `Bonjour ${prenom}, rappel : un test ACCECIT est prévu prochainement pour vous. ` +
    'Consultez votre convocation ou contactez l’accueil pour connaître la date exacte.',
  test_non_realise: (prenom) =>
    `Bonjour ${prenom}, vous ne vous êtes pas présenté(e) à votre test ACCECIT. ` +
    'Merci de contacter l’accueil pour reprogrammer.',
};
const MESSAGE_RELANCE_PAR_DEFAUT = (prenom) =>
  `Bonjour ${prenom}, nous revenons vers vous concernant votre dossier ACCECIT. ` +
  'Merci de contacter l’accueil pour plus d’informations.';

function construireMessageRelance(statutCode, candidatPrenom) {
  const construireMessage = MESSAGES_RELANCE_PAR_STATUT[statutCode] ?? MESSAGE_RELANCE_PAR_DEFAUT;
  return construireMessage(candidatPrenom);
}

// dossierId vient toujours de l'URL (voir relances.routes.js) : jamais traité sans confirmer au
// préalable qu'il appartient à l'entité résolue par entiteContext pour la requête en cours —
// même faille IDOR déjà corrigée pour les pièces justificatives (voir pieceJustificativeService.js).
async function verifierDossierAppartientEntite(bd, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
}

// utilisateurId vient toujours de la session (req.utilisateur.id, voir relances.routes.js),
// jamais du corps de la requête — même principe que uploadedBy pour les pièces justificatives
// (voir CLAUDE.auth-rbac.md). resultat n'est obligatoire (et respecté tel quel) que pour le canal
// 'telephone' — pour sms/email, il est ignoré s'il est fourni et recalculé ci-dessous d'après le
// succès/échec réel de l'envoi (voir CANAUX_ENVOI_REEL en tête de fichier).
async function enregistrerRelance(entite, { dossierId, canal, resultat, commentaire, utilisateurId }) {
  if (!CANAUX_AUTORISES.includes(canal)) {
    throw new Error(`Canal "${canal}" invalide (attendu : ${CANAUX_AUTORISES.join(', ')}).`);
  }

  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);

  let resultatFinal = resultat;

  if (CANAUX_ENVOI_REEL.includes(canal)) {
    if (!entite.sms_actif) {
      throw new Error(`L'envoi de notifications n'est pas activé pour l'entité « ${entite.code} ».`);
    }

    const [dossier, coordonnees] = await Promise.all([
      dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId),
      dossierRepository.trouverCoordonneesCandidat(bd, dossierId),
    ]);

    const destinataire = canal === 'email' ? coordonnees?.email : coordonnees?.telephone;
    if (!destinataire) {
      throw new Error(
        `Impossible d'envoyer la relance : aucun ${canal === 'email' ? 'email' : 'numéro de téléphone'} renseigné pour ce dossier.`,
      );
    }

    const message = construireMessageRelance(dossier?.statut_code, dossier?.candidat_prenom);
    const notificationProvider = notificationFactory();
    try {
      await notificationProvider.envoyer(destinataire, canal, message);
      resultatFinal = RESULTAT_ENVOI_REUSSI;
    } catch (erreur) {
      // Contrairement à rappelService.js (job automatique, rejouable), une relance manuelle
      // reste enregistrée même en cas d'échec d'envoi — l'agent doit voir que ça n'est pas parti,
      // pas simplement pouvoir réessayer un run silencieux plus tard.
      console.error(`Échec de l'envoi de la relance ${canal} pour le dossier "${dossierId}" :`, erreur.message);
      resultatFinal = RESULTAT_ENVOI_ECHEC;
    }
  } else if (!resultat) {
    throw new Error('Un résultat est obligatoire pour une relance téléphonique.');
  }

  const motif = await motifRepository.trouverMotifParCode(bd, entite.id, CATEGORIE_MOTIF_RESULTAT_RELANCE, resultatFinal);
  if (!motif) {
    throw new Error(`Résultat de relance "${resultatFinal}" non configuré pour l'entité « ${entite.code} ».`);
  }

  const relanceId = await relanceRepository.enregistrerRelance(bd, {
    dossierId,
    canal,
    resultat: resultatFinal,
    commentaire,
    utilisateurId,
  });
  return { relanceId, resultat: resultatFinal };
}

// Historique complet, du plus récent au plus ancien (voir relanceRepository.listerRelancesParDossier)
// — c'est ce qui permet à l'accueil/coordination de voir en un coup d'œil qu'une relance a déjà
// été faite avant d'en déclencher une nouvelle (besoin CLAUDE.md : "ne pas relancer en double").
async function listerRelances(entite, dossierId) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);
  return relanceRepository.listerRelancesParDossier(bd, dossierId);
}

async function listerMotifsResultatRelance(entite) {
  const bd = await db.obtenirKnex();
  return motifRepository.listerMotifsParCategorie(bd, entite.id, CATEGORIE_MOTIF_RESULTAT_RELANCE);
}

module.exports = { enregistrerRelance, listerRelances, listerMotifsResultatRelance };
