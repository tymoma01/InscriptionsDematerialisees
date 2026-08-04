const db = require('../../db/knex');
const lieuRepository = require('./lieuRepository');

// Sert le sélecteur de lieu de ModalePlanificationTest.jsx (voir lieux.routes.js) — même patron
// que utilisateurService.listerFormateursEtInspecteurs pour le sélecteur de formateur.
async function listerLieuxActifs(entite) {
  const bd = await db.obtenirKnex();
  return lieuRepository.listerLieuxActifs(bd, entite.id);
}

module.exports = { listerLieuxActifs };
