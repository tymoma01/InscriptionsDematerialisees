// Notes libres d'une demande DPAE — mêmes règles que les notes
// d'un dossier (core/dossier/notesDossierService.js) : auteur pris de la session, date posée par la
// base, aucune modification ni suppression. Module DPAE spécifique à ACCECIT (voir
// demandeDpaeService.js), notes stockées dans leur propre table (migration 071).

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');

const { ErreurDemandeIntrouvable, ErreurModificationInterdite } = demandeDpaeService;

// demandeId vient toujours de l'URL (voir dpae.routes.js) : jamais traité sans confirmer qu'il
// appartient à l'entité de la requête — sinon introuvable (404), comme GET /api/dpae/:id — ni sans
// que le rôle puisse consulter la demande (la RH ne voit pas celles encore chez le Planning : 403,
// même règle que la fiche).
async function verifierDemandeAccessible(bd, entite, demandeId, { roleCode, utilisateurId }) {
  const demande = await demandeDpaeRepository.trouverDemandeParId(bd, entite.id, demandeId);
  if (!demande) {
    throw new ErreurDemandeIntrouvable(`Demande DPAE "${demandeId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  if (!demandeDpaeService.peutConsulterDemande({ roleCode, utilisateurId, demande })) throw new ErreurModificationInterdite();
}

async function ajouterNote(entite, { demandeId, contenu, auteurId, roleCode }) {
  const bd = await db.obtenirKnex();
  await verifierDemandeAccessible(bd, entite, demandeId, { roleCode, utilisateurId: auteurId });
  const noteId = await notesDemandeDpaeRepository.ajouterNote(bd, { demandeId, auteurId, contenu });
  return { noteId };
}

// Du plus récent au plus ancien (voir notesDemandeDpaeRepository.listerNotesParDemande).
async function listerNotes(entite, demandeId, acces) {
  const bd = await db.obtenirKnex();
  await verifierDemandeAccessible(bd, entite, demandeId, acces);
  return notesDemandeDpaeRepository.listerNotesParDemande(bd, entite.id, demandeId);
}

module.exports = { ajouterNote, listerNotes };
