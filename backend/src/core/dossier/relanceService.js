const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const relanceRepository = require('./relanceRepository');
const motifRepository = require('../motifs/motifRepository');

const CATEGORIE_MOTIF_RESULTAT_RELANCE = 'resultat_relance';

// Canaux universels (SMS/email via le prestataire de notification, voir integrations/notifications/,
// ou appel téléphonique par l'accueil) — pas une donnée de configuration par entité comme les
// statuts ou les types de pièces (voir Modularité, CLAUDE.md) : ce sont les seuls canaux que ce
// projet sait déclencher/enregistrer, quelle que soit l'entité. Même patron que
// STATUTS_VERIFICATION_AUTORISES dans pieceJustificativeService.js (petite énumération fixe, pas
// de table dédiée). Nom du prestataire volontairement absent de ce commentaire : core/ ne doit
// jamais nommer de prestataire concret (voir docs/architecture-technique.md §3.4).
const CANAUX_AUTORISES = ['sms', 'email', 'telephone'];

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
// (voir CLAUDE.auth-rbac.md).
async function enregistrerRelance(entite, { dossierId, canal, resultat, commentaire, utilisateurId }) {
  if (!CANAUX_AUTORISES.includes(canal)) {
    throw new Error(`Canal "${canal}" invalide (attendu : ${CANAUX_AUTORISES.join(', ')}).`);
  }

  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);

  const motif = await motifRepository.trouverMotifParCode(bd, entite.id, CATEGORIE_MOTIF_RESULTAT_RELANCE, resultat);
  if (!motif) {
    throw new Error(`Résultat de relance "${resultat}" non configuré pour l'entité « ${entite.code} ».`);
  }

  const relanceId = await relanceRepository.enregistrerRelance(bd, { dossierId, canal, resultat, commentaire, utilisateurId });
  return { relanceId };
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
