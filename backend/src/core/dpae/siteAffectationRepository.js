// Accès au référentiel des sites d'affectation (table `sites_affectation`, migration 069) et à leurs
// liens avec les demandes DPAE (table `demandes_dpae_sites`). Toutes les fonctions prennent `trx`
// (instance knex ou transaction) en premier argument, même convention que demandeDpaeRepository.js.

const COLONNES_SITE = ['sites_affectation.id', 'sites_affectation.nom', 'sites_affectation.initiales'];

// Sites proposés dans le formulaire DPAE : actifs uniquement, triés par nom sans tenir compte des
// majuscules (même règle que l'unicité, voir migration 069).
function listerSitesActifs(trx, entiteId) {
  return trx('sites_affectation')
    .where({ entite_id: entiteId, actif: true })
    .select(COLONNES_SITE)
    .orderByRaw('lower(sites_affectation.nom) asc');
}

// Sites de l'entité (actifs OU non) dont le nom ou les initiales entrent en collision, sans tenir
// compte des majuscules — un site désactivé bloque toujours son nom et ses initiales, comme l'index
// unique lui-même (migration 069).
function listerSitesEnConflit(trx, entiteId, { nom, initiales }) {
  return trx('sites_affectation')
    .where({ entite_id: entiteId })
    .andWhere((requete) => {
      requete.whereRaw('lower(nom) = lower(?)', [nom]).orWhereRaw('lower(initiales) = lower(?)', [initiales]);
    })
    .select(COLONNES_SITE);
}

async function creerSite(trx, { entiteId, nom, initiales }) {
  const [site] = await trx('sites_affectation').insert({ entite_id: entiteId, nom, initiales }).returning(['id', 'nom', 'initiales']);
  return site;
}

// Parmi `ids`, ceux qui existent, sont actifs ET appartiennent à l'entité — sert à refuser toute
// demande DPAE qui référence un site absent de cette liste (voir demandeDpaeService.creerEtEnvoyer).
async function listerIdsSitesValides(trx, entiteId, ids) {
  const lignes = await trx('sites_affectation').where({ entite_id: entiteId, actif: true }).whereIn('id', ids).select('id');
  return lignes.map((ligne) => ligne.id);
}

function lierSitesDemande(trx, demandeId, siteIds) {
  return trx('demandes_dpae_sites').insert(siteIds.map((siteId) => ({ demande_dpae_id: demandeId, site_affectation_id: siteId })));
}

// Sites liés à une demande (affichage fiche RH), triés par nom — y compris un site désactivé depuis :
// la demande garde la trace de ce qui a réellement été choisi.
function listerSitesDemande(trx, demandeId) {
  return trx('demandes_dpae_sites')
    .join('sites_affectation', 'sites_affectation.id', 'demandes_dpae_sites.site_affectation_id')
    .where({ 'demandes_dpae_sites.demande_dpae_id': demandeId })
    .select(COLONNES_SITE)
    .orderByRaw('lower(sites_affectation.nom) asc');
}

module.exports = {
  listerSitesActifs,
  listerSitesEnConflit,
  creerSite,
  listerIdsSitesValides,
  lierSitesDemande,
  listerSitesDemande,
};
