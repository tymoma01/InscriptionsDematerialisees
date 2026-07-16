const crypto = require('crypto');
const { obtenirSecret, invaliderSecret } = require('./keyVaultClient');

const NOM_SECRET_CLE = 'nir-encryption-key';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_IV_OCTETS = 12; // taille recommandée (96 bits) pour AES-GCM
const TAILLE_CLE_OCTETS = 32; // AES-256
const TAILLE_TAG_OCTETS = 16; // taille fixe du tag d'authentification GCM produit par Node

let promesseCle;

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

module.exports = {
  chiffrerNir,
  dechiffrerNir,
  chiffrerNirPourColonnes,
  dechiffrerNirDepuisColonnes,
  invaliderCacheCle,
};
