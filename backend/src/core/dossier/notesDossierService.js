const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const notesDossierRepository = require('./notesDossierRepository');

// dossierId vient toujours de l'URL (voir notes.routes.js) : jamais traité sans confirmer au
// préalable qu'il appartient à l'entité résolue par entiteContext pour la requête en cours —
// même faille IDOR déjà corrigée pour les pièces justificatives/relances/rendez-vous (voir
// relanceService.verifierDossierAppartientEntite).
async function verifierDossierAppartientEntite(bd, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
}

// auteurId vient toujours de la session (req.utilisateur.id, voir notes.routes.js), jamais du
// corps de la requête — même principe que utilisateurId pour les relances.
async function ajouterNote(entite, { dossierId, contenu, auteurId }) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);
  const noteId = await notesDossierRepository.ajouterNote(bd, { dossierId, auteurId, contenu });
  return { noteId };
}

// Historique complet, du plus récent au plus ancien (voir notesDossierRepository.
// listerNotesParDossier) — simple journal consultable, sans logique de "déjà vu" contrairement à
// l'historique des relances (pas de besoin métier équivalent identifié pour les notes).
async function listerNotes(entite, dossierId) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);
  return notesDossierRepository.listerNotesParDossier(bd, dossierId);
}

module.exports = { ajouterNote, listerNotes };
