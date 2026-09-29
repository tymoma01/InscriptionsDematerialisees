const db = require('../../db/knex');
const siteAffectationRepository = require('./siteAffectationRepository');

// Code d'erreur PostgreSQL "unique_violation" — filet de sécurité si deux ajouts simultanés passent
// tous deux la vérification préalable (voir creerSite) : l'index unique (migration 069) tranche.
const CODE_PG_VIOLATION_UNICITE = '23505';

class ErreurSiteAffectationDoublon extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurSiteAffectationDoublon';
  }
}

async function listerSitesActifs(entite) {
  const bd = await db.obtenirKnex();
  return siteAffectationRepository.listerSitesActifs(bd, entite.id);
}

// Ajout d'un site depuis le formulaire DPAE (bouton « + »). `nom`/`initiales` déjà validés et
// normalisés par la route (trim, format des initiales). Doublon de nom ou d'initiales refusé avec un
// message explicite, sans tenir compte des majuscules — même règle que l'index unique.
async function creerSite(entite, { nom, initiales }) {
  const bd = await db.obtenirKnex();
  const conflits = await siteAffectationRepository.listerSitesEnConflit(bd, entite.id, { nom, initiales });
  const conflitNom = conflits.find((site) => site.nom.toLowerCase() === nom.toLowerCase());
  if (conflitNom) {
    throw new ErreurSiteAffectationDoublon(`Un site nommé « ${conflitNom.nom} » existe déjà.`);
  }
  const conflitInitiales = conflits.find((site) => site.initiales.toLowerCase() === initiales.toLowerCase());
  if (conflitInitiales) {
    throw new ErreurSiteAffectationDoublon(
      `Les initiales « ${conflitInitiales.initiales} » sont déjà utilisées par le site « ${conflitInitiales.nom} ».`,
    );
  }
  try {
    return await siteAffectationRepository.creerSite(bd, { entiteId: entite.id, nom, initiales });
  } catch (erreur) {
    if (erreur.code === CODE_PG_VIOLATION_UNICITE) {
      throw new ErreurSiteAffectationDoublon('Un site avec ce nom ou ces initiales existe déjà.');
    }
    throw erreur;
  }
}

module.exports = {
  ErreurSiteAffectationDoublon,
  listerSitesActifs,
  creerSite,
};
