const crypto = require('crypto');
const fs = require('fs');
const fsPromises = require('fs/promises');
const { pipeline } = require('stream/promises');
const { obtenirSecret, invaliderSecret } = require('../securite/keyVaultClient');

// Clé dédiée aux sauvegardes, volontairement distincte de "nir-encryption-key"
// (core/securite/nirCipher.js) — ne jamais réutiliser une même clé pour deux usages
// cryptographiques différents (voir le même principe déjà appliqué là-bas entre clé de
// chiffrement et clé HMAC).
const NOM_SECRET_CLE = 'backup-encryption-key';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_IV_OCTETS = 12; // taille recommandée (96 bits) pour AES-GCM
const TAILLE_CLE_OCTETS = 32; // AES-256
const TAILLE_TAG_OCTETS = 16; // taille fixe du tag d'authentification GCM produit par Node

let promesseCle;

// Clé AES-256 récupérée depuis Azure Key Vault — jamais dans le code ni dans une variable
// d'environnement en clair (même politique que nirCipher.js). Secret stocké encodé en base64.
async function obtenirCle() {
  if (!promesseCle) {
    promesseCle = obtenirSecret(NOM_SECRET_CLE).then((valeurBase64) => {
      if (!valeurBase64) {
        throw new Error(`Secret "${NOM_SECRET_CLE}" introuvable dans Key Vault`);
      }
      const cle = Buffer.from(valeurBase64, 'base64');
      if (cle.length !== TAILLE_CLE_OCTETS) {
        throw new Error(
          `Le secret "${NOM_SECRET_CLE}" doit décoder en ${TAILLE_CLE_OCTETS} octets (AES-256) une fois décodé en base64, obtenu : ${cle.length} octet(s)`,
        );
      }
      return cle;
    });
    promesseCle.catch(() => {
      promesseCle = undefined;
    });
  }
  return promesseCle;
}

// À appeler après rotation de la clé dans Key Vault.
function invaliderCacheCle() {
  promesseCle = undefined;
  invaliderSecret(NOM_SECRET_CLE);
}

/**
 * Chiffre le fichier `cheminEntree` vers `cheminSortie`, en streaming (jamais chargé en entier en
 * mémoire — un dump Neon peut être volumineux). Format binaire du fichier produit :
 * IV (12 octets) || données chiffrées || tag d'authentification GCM (16 octets).
 */
async function chiffrerFichier(cheminEntree, cheminSortie) {
  const cle = await obtenirCle();
  const iv = crypto.randomBytes(TAILLE_IV_OCTETS);
  const chiffreur = crypto.createCipheriv(ALGORITHME, cle, iv);

  const entree = fs.createReadStream(cheminEntree);
  const sortie = fs.createWriteStream(cheminSortie);

  await new Promise((resolve, reject) => {
    sortie.on('error', reject);
    entree.on('error', reject);
    chiffreur.on('error', reject);

    sortie.write(iv);
    entree.pipe(chiffreur).pipe(sortie, { end: false });

    // Le tag GCM n'est disponible qu'une fois le chiffrement du corps terminé (final() est appelé
    // en interne par le flux Cipher juste avant d'émettre 'end') : on l'ajoute donc après coup,
    // en dernier, avant de clore explicitement le flux de sortie.
    chiffreur.on('end', () => {
      sortie.end(chiffreur.getAuthTag(), (erreur) => (erreur ? reject(erreur) : resolve()));
    });
  });
}

/**
 * Déchiffre un fichier produit par chiffrerFichier. Lève une erreur explicite si le format est
 * invalide ou si le tag GCM ne correspond pas (fichier corrompu ou mauvaise clé), sans jamais
 * inclure de contenu sensible dans le message.
 */
async function dechiffrerFichier(cheminEntree, cheminSortie) {
  const cle = await obtenirCle();
  const { size: taille } = await fsPromises.stat(cheminEntree);
  const tailleCorps = taille - TAILLE_IV_OCTETS - TAILLE_TAG_OCTETS;

  if (tailleCorps < 0) {
    throw new Error(
      `Fichier de sauvegarde chiffré invalide : trop petit (${taille} octet(s), attendu au moins ${TAILLE_IV_OCTETS + TAILLE_TAG_OCTETS}).`,
    );
  }

  const handle = await fsPromises.open(cheminEntree, 'r');
  try {
    const bufferIv = Buffer.alloc(TAILLE_IV_OCTETS);
    await handle.read(bufferIv, 0, TAILLE_IV_OCTETS, 0);

    const bufferTag = Buffer.alloc(TAILLE_TAG_OCTETS);
    await handle.read(bufferTag, 0, TAILLE_TAG_OCTETS, TAILLE_IV_OCTETS + tailleCorps);

    const dechiffreur = crypto.createDecipheriv(ALGORITHME, cle, bufferIv);
    dechiffreur.setAuthTag(bufferTag);

    const entreeCorps = fs.createReadStream(cheminEntree, {
      start: TAILLE_IV_OCTETS,
      end: TAILLE_IV_OCTETS + tailleCorps - 1, // `end` inclusif pour createReadStream
    });
    const sortie = fs.createWriteStream(cheminSortie);

    try {
      await pipeline(entreeCorps, dechiffreur, sortie);
    } catch {
      throw new Error('Échec du déchiffrement de la sauvegarde : fichier corrompu ou mauvaise clé (tag GCM invalide).');
    }
  } finally {
    await handle.close();
  }
}

module.exports = { chiffrerFichier, dechiffrerFichier, invaliderCacheCle };
