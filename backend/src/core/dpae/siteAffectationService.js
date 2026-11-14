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

async function listerSitesActifs(entite, secteur = 'hotellerie') {
  const bd = await db.obtenirKnex();
  return siteAffectationRepository.listerSitesActifs(bd, entite.id, secteur);
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

// --- Sites du Tertiaire -------------------------------------------------------------------------------
const SECTEUR_TERTIAIRE = 'tertiaire';

// Site existant proche d'un nom saisi : à choisir plutôt que de créer un doublon (409, avec le site).
class ErreurSiteProche extends Error {
  constructor(message, { sitesProches, identique }) {
    super(message);
    this.name = 'ErreurSiteProche';
    this.sitesProches = sitesProches;
    this.identique = identique;
  }
}
// Renommage d'un site inexistant, d'un autre secteur ou d'une autre entité (404).
class ErreurSiteIntrouvable extends Error {}

// Nom comparable : minuscules, sans accents, sans espaces ni ponctuation.
function normaliserNomSite(nom) {
  return String(nom ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Distance d'édition (Levenshtein) entre deux chaînes courtes.
function distanceEdition(a, b) {
  const precedente = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonale = precedente[0];
    precedente[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const sauvegarde = precedente[j];
      precedente[j] = Math.min(precedente[j] + 1, precedente[j - 1] + 1, diagonale + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonale = sauvegarde;
    }
  }
  return precedente[b.length];
}

// Sites dont le nom est identique (casse, accents, espaces ignorés) ou très proche (une seule faute de
// frappe, pour les noms d'au moins 5 caractères) à `nom`. `identique` : au moins un nom strictement équivalent.
function trouverSitesProches(sites, nom) {
  const reference = normaliserNomSite(nom);
  if (!reference) return { sitesProches: [], identique: false };
  const proches = [];
  let identique = false;
  for (const site of sites) {
    const candidat = normaliserNomSite(site.nom);
    if (candidat === reference) {
      identique = true;
      proches.push(site);
    } else if (Math.min(candidat.length, reference.length) >= 5 && distanceEdition(candidat, reference) <= 1) {
      proches.push(site);
    }
  }
  return { sitesProches: proches, identique };
}

// Création par un demandeur du Tertiaire : nom (obligatoire) et adresse (facultative). Un nom identique à un
// site existant, actif ou non, est toujours refusé ; un nom très proche l'est aussi tant que le demandeur ne
// confirme pas (`confirmerProche`), pour éviter les doublons.
async function creerSiteTertiaire(entite, { nom, adresse = null, creeParId, confirmerProche = false }) {
  const bd = await db.obtenirKnex();
  const sites = await siteAffectationRepository.listerSitesGestion(bd, entite.id, SECTEUR_TERTIAIRE);
  const { sitesProches, identique } = trouverSitesProches(sites, nom);
  if (identique) {
    throw new ErreurSiteProche(`Un site au nom très proche existe déjà : « ${sitesProches[0].nom} ». Choisissez-le plutôt que d’en créer un nouveau.`, { sitesProches, identique });
  }
  if (sitesProches.length > 0 && !confirmerProche) {
    throw new ErreurSiteProche(`Un site au nom proche existe déjà : « ${sitesProches[0].nom} ». Choisissez-le, ou confirmez la création.`, { sitesProches, identique });
  }
  try {
    return await siteAffectationRepository.creerSite(bd, { entiteId: entite.id, nom, adresse, secteur: SECTEUR_TERTIAIRE, creeParId });
  } catch (erreur) {
    if (erreur.code === CODE_PG_VIOLATION_UNICITE) throw new ErreurSiteAffectationDoublon(`Un site nommé « ${nom} » existe déjà.`);
    throw erreur;
  }
}

async function trouverSiteTertiaire(bd, entite, siteId) {
  const site = await siteAffectationRepository.trouverSite(bd, entite.id, siteId);
  if (!site || site.secteur !== SECTEUR_TERTIAIRE) throw new ErreurSiteIntrouvable(`Site n° ${siteId} introuvable parmi les sites du Tertiaire.`);
  return site;
}

// Renommage et adresse : le nouveau nom ne doit pas être celui d'un AUTRE site.
// Renommage d'un site du Tertiaire (Planning Tertiaire, Admin) : même contrôle de doublon qu'à la création, un
// nom identique OU très proche d'un AUTRE site est refusé. Les demandes référencent le site par son identifiant :
// le nouveau nom s'applique donc partout, y compris sur les demandes existantes et leur PDF.
async function renommerSiteTertiaire(entite, siteId, { nom }) {
  const bd = await db.obtenirKnex();
  const site = await trouverSiteTertiaire(bd, entite, siteId);
  const autres = (await siteAffectationRepository.listerSitesGestion(bd, entite.id, SECTEUR_TERTIAIRE)).filter((autre) => autre.id !== site.id);
  const { sitesProches, identique } = trouverSitesProches(autres, nom);
  if (sitesProches.length > 0) {
    throw new ErreurSiteAffectationDoublon(
      identique
        ? `Un site nommé « ${sitesProches[0].nom} » existe déjà : ce nom ne peut pas être utilisé.`
        : `Un site au nom très proche existe déjà : « ${sitesProches[0].nom} ». Choisissez un nom plus distinct.`,
    );
  }
  try {
    await siteAffectationRepository.mettreAJourSite(bd, entite.id, siteId, { nom });
  } catch (erreur) {
    if (erreur.code === CODE_PG_VIOLATION_UNICITE) throw new ErreurSiteAffectationDoublon(`Un site nommé « ${nom} » existe déjà.`);
    throw erreur;
  }
  return { avant: { nom: site.nom }, apres: { nom } };
}

module.exports = {
  ErreurSiteAffectationDoublon,
  ErreurSiteProche,
  ErreurSiteIntrouvable,
  SECTEUR_TERTIAIRE,
  normaliserNomSite,
  trouverSitesProches,
  listerSitesActifs,
  creerSite,
  creerSiteTertiaire,
  renommerSiteTertiaire,
};
