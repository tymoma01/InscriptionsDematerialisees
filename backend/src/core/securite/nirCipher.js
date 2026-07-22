const crypto = require('crypto');
const { obtenirSecret, invaliderSecret } = require('./keyVaultClient');

const NOM_SECRET_CLE = 'nir-encryption-key';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_IV_OCTETS = 12; // taille recommandée (96 bits) pour AES-GCM
const TAILLE_CLE_OCTETS = 32; // AES-256
const TAILLE_TAG_OCTETS = 16; // taille fixe du tag d'authentification GCM produit par Node

// Clé séparée de nir-encryption-key : ne jamais réutiliser une même clé pour deux usages
// cryptographiques différents (ici chiffrement confidentialité vs. authentification de message
// pour la recherche d'unicité) — voir hasherNirPourUnicite plus bas.
const NOM_SECRET_CLE_HMAC = 'nir-hmac-key';
const TAILLE_CLE_HMAC_OCTETS = 32;

let promesseCle;
let promesseCleHmac;

// Clé AES-256 récupérée depuis Azure Key Vault — jamais dans le code ni dans une variable
// d'environnement en clair (voir CLAUDE.md, section RGPD, et architecture-technique.md §1.7).
// Le secret est stocké encodé en base64 dans le Key Vault, décodé ici en Buffer 32 octets.
async function obtenirCle() {
  if (!promesseCle) {
    promesseCle = obtenirSecret(NOM_SECRET_CLE).then((valeurBase64) => {
      if (!valeurBase64) {
        throw new Error(`Secret "${NOM_SECRET_CLE}" introuvable dans Key Vault`);
      }
      const cle = Buffer.from(valeurBase64, 'base64');
      if (cle.length !== TAILLE_CLE_OCTETS) {
        throw new Error(
          `Le secret "${NOM_SECRET_CLE}" doit décoder en ${TAILLE_CLE_OCTETS} octets (AES-256) une fois décodé en base64, obtenu : ${cle.length} octet(s)`
        );
      }
      return cle;
    });
    // Ne pas garder en cache une récupération/validation en échec.
    promesseCle.catch(() => {
      promesseCle = undefined;
    });
  }
  return promesseCle;
}

// À appeler après rotation de la clé dans Key Vault, pour forcer une relecture
// au prochain chiffrement/déchiffrement plutôt que de continuer à utiliser l'ancienne clé en cache.
function invaliderCacheCle() {
  promesseCle = undefined;
  invaliderSecret(NOM_SECRET_CLE);
}

// Même logique que obtenirCle(), pour la clé HMAC (secret Key Vault séparé).
async function obtenirCleHmac() {
  if (!promesseCleHmac) {
    promesseCleHmac = obtenirSecret(NOM_SECRET_CLE_HMAC).then((valeurBase64) => {
      if (!valeurBase64) {
        throw new Error(`Secret "${NOM_SECRET_CLE_HMAC}" introuvable dans Key Vault`);
      }
      const cle = Buffer.from(valeurBase64, 'base64');
      if (cle.length !== TAILLE_CLE_HMAC_OCTETS) {
        throw new Error(
          `Le secret "${NOM_SECRET_CLE_HMAC}" doit décoder en ${TAILLE_CLE_HMAC_OCTETS} octets une fois décodé en base64, obtenu : ${cle.length} octet(s)`
        );
      }
      return cle;
    });
    promesseCleHmac.catch(() => {
      promesseCleHmac = undefined;
    });
  }
  return promesseCleHmac;
}

function invaliderCacheCleHmac() {
  promesseCleHmac = undefined;
  invaliderSecret(NOM_SECRET_CLE_HMAC);
}

/**
 * Hash déterministe du NIR (HMAC-SHA256) : permet une recherche d'unicité en base (égalité
 * directe) là où le chiffrement AES-256-GCM ne le permet pas (non déterministe par nature — même
 * NIR en clair chiffré deux fois donne deux résultats différents, à cause de l'IV aléatoire).
 * HMAC plutôt qu'un simple SHA-256 : un NIR n'a qu'environ 10^12 combinaisons plausibles (13
 * chiffres structurés par date de naissance/département) — un hash sans clé secrète serait
 * cassable par dictionnaire précalculé par quiconque a accès à la colonne. La clé HMAC, tenue
 * secrète dans Key Vault, empêche cette attaque tant qu'elle reste elle-même non compromise.
 * Ne jamais exposer ce hash au front ni le faire figurer dans une réponse API — il ne sert qu'à
 * une comparaison d'égalité côté serveur.
 */
async function hasherNirPourUnicite(nirClair) {
  if (typeof nirClair !== 'string' || nirClair.length === 0) {
    throw new Error('hasherNirPourUnicite attend une chaîne non vide');
  }
  const cle = await obtenirCleHmac();
  return crypto.createHmac('sha256', cle).update(nirClair, 'utf8').digest();
}

/**
 * Chiffre un NIR en clair et retourne une chaîne stockable (JSON base64 : iv + tag + données).
 */
async function chiffrerNir(nirClair) {
  if (typeof nirClair !== 'string' || nirClair.length === 0) {
    throw new Error('chiffrerNir attend une chaîne non vide');
  }

  const cle = await obtenirCle();
  const iv = crypto.randomBytes(TAILLE_IV_OCTETS);
  const chiffreur = crypto.createCipheriv(ALGORITHME, cle, iv);
  const donneesChiffrees = Buffer.concat([chiffreur.update(nirClair, 'utf8'), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    donnees: donneesChiffrees.toString('base64'),
  });
}

/**
 * Déchiffre une valeur produite par chiffrerNir et retourne le NIR en clair.
 * Lève une erreur explicite si le format est invalide ou si le tag GCM ne correspond pas
 * (donnée corrompue ou mauvaise clé) — sans jamais inclure de contenu sensible dans le message.
 */
async function dechiffrerNir(valeurChiffree) {
  let iv;
  let tag;
  let donnees;
  try {
    ({ iv, tag, donnees } = JSON.parse(valeurChiffree));
    if (!iv || !tag || !donnees) {
      throw new Error('champs manquants');
    }
  } catch {
    throw new Error('Format de NIR chiffré invalide (attendu : JSON avec les champs iv/tag/donnees)');
  }

  const cle = await obtenirCle();
  const dechiffreur = crypto.createDecipheriv(ALGORITHME, cle, Buffer.from(iv, 'base64'));
  dechiffreur.setAuthTag(Buffer.from(tag, 'base64'));

  try {
    const clair = Buffer.concat([dechiffreur.update(Buffer.from(donnees, 'base64')), dechiffreur.final()]);
    return clair.toString('utf8');
  } catch {
    throw new Error('Échec du déchiffrement du NIR : donnée corrompue ou mauvaise clé (tag GCM invalide)');
  }
}

/**
 * Variante de chiffrerNir qui répartit le résultat sur deux colonnes bytea (`nir`, `nir_iv`),
 * pour correspondre au schéma déjà en place (migration 008_creation_table_candidats.js) sans
 * avoir besoin d'y toucher : `nir` reçoit données chiffrées + tag concaténés, `nir_iv` reçoit l'IV.
 */
async function chiffrerNirPourColonnes(nirClair) {
  const valeurChiffree = await chiffrerNir(nirClair);
  const { iv, tag, donnees } = JSON.parse(valeurChiffree);
  return {
    nir: Buffer.concat([Buffer.from(donnees, 'base64'), Buffer.from(tag, 'base64')]),
    nirIv: Buffer.from(iv, 'base64'),
  };
}

/**
 * Inverse de chiffrerNirPourColonnes : reconstitue le NIR en clair à partir des deux colonnes bytea.
 */
async function dechiffrerNirDepuisColonnes(colonneNir, colonneNirIv) {
  if (!Buffer.isBuffer(colonneNir) || !Buffer.isBuffer(colonneNirIv)) {
    throw new Error('dechiffrerNirDepuisColonnes attend deux Buffer (colonnes bytea nir et nir_iv)');
  }
  const tag = colonneNir.subarray(colonneNir.length - TAILLE_TAG_OCTETS);
  const donnees = colonneNir.subarray(0, colonneNir.length - TAILLE_TAG_OCTETS);
  const valeurChiffree = JSON.stringify({
    iv: colonneNirIv.toString('base64'),
    tag: tag.toString('base64'),
    donnees: donnees.toString('base64'),
  });
  return dechiffrerNir(valeurChiffree);
}

// Alias conservés pour compatibilité avec dossierService.js (`const { chiffrer } = require('../securite/nirCipher')`) :
// même opération que chiffrerNirPourColonnes/dechiffrerNirDepuisColonnes, avec les noms de champs
// nirChiffre/iv déjà utilisés par ce consommateur plutôt que nir/nirIv.
async function chiffrer(nirClair) {
  const { nir, nirIv } = await chiffrerNirPourColonnes(nirClair);
  return { nirChiffre: nir, iv: nirIv };
}

function dechiffrer(nirChiffre, iv) {
  return dechiffrerNirDepuisColonnes(nirChiffre, iv);
}

module.exports = {
  chiffrerNir,
  dechiffrerNir,
  chiffrerNirPourColonnes,
  dechiffrerNirDepuisColonnes,
  invaliderCacheCle,
  invaliderCacheCleHmac,
  hasherNirPourUnicite,
  chiffrer,
  dechiffrer,
};
