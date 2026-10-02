// Notes libres d'une demande DPAE — mêmes règles que les notes
// d'un dossier (core/dossier/notesDossierService.js) : auteur pris de la session, date posée par la
// base, aucune modification ni suppression. Module DPAE spécifique à ACCECIT (voir
// demandeDpaeService.js), notes stockées dans leur propre table (migration 071).

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const { ErreurDemandeIntrouvable } = require('./demandeDpaeService');

// demandeId vient toujours de l'URL (voir dpae.routes.js) : jamais traité sans confirmer qu'il
// appartient à l'entité de la requête — sinon introuvable (404), comme GET /api/dpae/:id.
async function verifierDemandeAppartientEntite(bd, entite, demandeId) {
  const demande = await demandeDpaeRepository.trouverDemandeParId(bd, entite.id, demandeId);
  if (!demande) {
    throw new ErreurDemandeIntrouvable(`Demande DPAE "${demandeId}" introuvable pour l'entité « ${entite.code} ».`);
  }
}

async function ajouterNote(entite, { demandeId, contenu, auteurId }) {
  const bd = await db.obtenirKnex();
  await verifierDemandeAppartientEntite(bd, entite, demandeId);
  const noteId = await notesDemandeDpaeRepository.ajouterNote(bd, { demandeId, auteurId, contenu });
  return { noteId };
}

// Du plus récent au plus ancien (voir notesDemandeDpaeRepository.listerNotesParDemande).
async function listerNotes(entite, demandeId) {
  const bd = await db.obtenirKnex();
  await verifierDemandeAppartientEntite(bd, entite, demandeId);
  return notesDemandeDpaeRepository.listerNotesParDemande(bd, entite.id, demandeId);
}

module.exports = { ajouterNote, listerNotes };
