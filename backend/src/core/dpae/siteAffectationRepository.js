// Accès au référentiel des sites d'affectation (table `sites_affectation`, migration 069) et à leurs
// liens avec les demandes DPAE (table `demandes_dpae_sites`). Toutes les fonctions prennent `trx`
// (instance knex ou transaction) en premier argument, même convention que demandeDpaeRepository.js.

const COLONNES_SITE = ['sites_affectation.id', 'sites_affectation.nom', 'sites_affectation.initiales', 'sites_affectation.adresse'];

// Sites proposés dans le formulaire DPAE : actifs uniquement, triés par nom sans tenir compte des
// majuscules (même règle que l'unicité, voir migration 069).
// `secteur` : 'hotellerie' (liste historique, défaut) ou 'tertiaire' (sites créés par les demandeurs du Tertiaire).
function listerSitesActifs(trx, entiteId, secteur = 'hotellerie') {
  return trx('sites_affectation')
    .where({ entite_id: entiteId, actif: true, secteur })
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

async function creerSite(trx, { entiteId, nom, initiales = null, secteur = 'hotellerie', adresse = null, creeParId = null }) {
  const [site] = await trx('sites_affectation')
    .insert({ entite_id: entiteId, nom, initiales, secteur, adresse, cree_par_id: creeParId })
    .returning(['id', 'nom', 'initiales', 'adresse']);
  return site;
}

// Tous les sites d'un secteur, actifs ou non (détection des noms identiques ou proches), avec leur auteur.
function listerSitesGestion(trx, entiteId, secteur) {
  return trx('sites_affectation')
    .leftJoin('utilisateurs', 'utilisateurs.id', 'sites_affectation.cree_par_id')
    .where({ 'sites_affectation.entite_id': entiteId, 'sites_affectation.secteur': secteur })
    .select(
      'sites_affectation.id',
      'sites_affectation.nom',
      'sites_affectation.initiales',
      'sites_affectation.adresse',
      'sites_affectation.actif',
      'sites_affectation.date_creation',
      'utilisateurs.prenom as cree_par_prenom',
      'utilisateurs.nom as cree_par_nom',
    )
    .orderByRaw('lower(sites_affectation.nom) asc');
}

function trouverSite(trx, entiteId, id) {
  return trx('sites_affectation').where({ entite_id: entiteId, id }).first();
}

function mettreAJourSite(trx, entiteId, id, valeurs) {
  return trx('sites_affectation')
    .where({ entite_id: entiteId, id })
    .update({ ...valeurs, date_maj: trx.fn.now() });
}

// Parmi `ids`, ceux qui existent, sont actifs ET appartiennent à l'entité — sert à refuser toute
// demande DPAE qui référence un site absent de cette liste (voir demandeDpaeService.creerEtEnvoyer).
async function listerIdsSitesValides(trx, entiteId, ids, secteur = 'hotellerie') {
  const lignes = await trx('sites_affectation').where({ entite_id: entiteId, actif: true, secteur }).whereIn('id', ids).select('id');
  return lignes.map((ligne) => ligne.id);
}

function lierSitesDemande(trx, demandeId, siteIds) {
  return trx('demandes_dpae_sites').insert(siteIds.map((siteId) => ({ demande_dpae_id: demandeId, site_affectation_id: siteId })));
}

// Remplace TOUS les liens d'une demande par `siteIds` (modification d'une demande) — à appeler dans
// la transaction qui met la demande à jour.
async function remplacerSitesDemande(trx, demandeId, siteIds) {
  await trx('demandes_dpae_sites').where({ demande_dpae_id: demandeId }).del();
  await lierSitesDemande(trx, demandeId, siteIds);
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

// Sites de plusieurs demandes en une requête (liste de suivi, 2026-09-30) — une ligne par lien,
// avec demande_dpae_id pour regroupement côté service. Aucune demande sans site n'y figure :
// c'est au service de retomber sur l'ancien texte `hotel` pour celles-là (jamais de jointure
// stricte sur la liste des demandes elle-même, qui les exclurait).
function listerSitesParDemandes(trx, demandeIds) {
  if (demandeIds.length === 0) return Promise.resolve([]);
  return trx('demandes_dpae_sites')
    .join('sites_affectation', 'sites_affectation.id', 'demandes_dpae_sites.site_affectation_id')
    .whereIn('demandes_dpae_sites.demande_dpae_id', demandeIds)
    .select('demandes_dpae_sites.demande_dpae_id', ...COLONNES_SITE)
    .orderByRaw('lower(sites_affectation.nom) asc');
}

module.exports = {
  listerSitesParDemandes,
  listerSitesActifs,
  listerSitesEnConflit,
  listerSitesGestion,
  trouverSite,
  mettreAJourSite,
  creerSite,
  listerIdsSitesValides,
  lierSitesDemande,
  remplacerSitesDemande,
  listerSitesDemande,
};
