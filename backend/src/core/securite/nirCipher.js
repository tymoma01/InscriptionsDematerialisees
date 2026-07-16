const crypto = require('crypto');
const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const VAULT_URL = 'https://secretsforinscriptions.vault.azure.net';
const NOM_SECRET_CLE_NIR = 'nir-encryption-key';
const ALGORITHME = 'aes-256-gcm';
const TAILLE_TAG_OCTETS = 16;

let promesseCle;

// Clé AES-256 récupérée depuis Azure Key Vault — jamais dans le code ni dans une variable
// d'environnement en clair (voir CLAUDE.md, section RGPD, et architecture-technique.md §1.7).
// Le secret est stocké encodé en base64 dans le Key Vault, décodé ici en Buffer 32 octets.
// DefaultAzureCredential utilise `az login` en local et une Managed Identity en production.
function obtenirCle() {
  if (!promesseCle) {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(VAULT_URL, credential);
    promesseCle = client.getSecret(NOM_SECRET_CLE_NIR).then((secret) => Buffer.from(secret.value, 'base64'));
  }
  return promesseCle;
}

// Chiffre un NIR en clair. Retourne le ciphertext (avec le tag d'authentification GCM
// accolé, pour tenir dans la seule colonne `nir`) et l'IV, à stocker dans `nir_iv`.
async function chiffrer(nirClair) {
  const cle = await obtenirCle();
  const iv = crypto.randomBytes(12);
  const chiffreur = crypto.createCipheriv(ALGORITHME, cle, iv);
  const chiffre = Buffer.concat([chiffreur.update(nirClair, 'utf8'), chiffreur.final()]);
  const tag = chiffreur.getAuthTag();

  return { nirChiffre: Buffer.concat([chiffre, tag]), iv };
}

// Déchiffre un NIR précédemment chiffré par `chiffrer` — usage strictement côté serveur,
// jamais exposé au frontend ni journalisé en clair (voir architecture-technique.md §1.7).
async function dechiffrer(nirChiffre, iv) {
  const cle = await obtenirCle();
  const tag = nirChiffre.subarray(nirChiffre.length - TAILLE_TAG_OCTETS);
  const ciphertext = nirChiffre.subarray(0, nirChiffre.length - TAILLE_TAG_OCTETS);

  const dechiffreur = crypto.createDecipheriv(ALGORITHME, cle, iv);
  dechiffreur.setAuthTag(tag);

  return Buffer.concat([dechiffreur.update(ciphertext), dechiffreur.final()]).toString('utf8');
}

module.exports = { chiffrer, dechiffrer };
