const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const VAULT_URL = 'https://secretsforinscriptions.vault.azure.net';

let client;
const promessesParSecret = new Map();

function obtenirClient() {
  if (!client) {
    client = new SecretClient(VAULT_URL, new DefaultAzureCredential());
  }
  return client;
}

// DefaultAzureCredential utilise `az login` en local et une Managed Identity en production —
// aucune variable d'environnement à renseigner pour l'authentification au Key Vault.
function obtenirSecret(nomSecret) {
  if (!promessesParSecret.has(nomSecret)) {
    const promesse = obtenirClient()
      .getSecret(nomSecret)
      .then((secret) => secret.value);
    // Ne pas garder en cache une récupération en échec, sinon un secret temporairement
    // indisponible resterait cassé pour toute la durée de vie du process.
    promesse.catch(() => promessesParSecret.delete(nomSecret));
    promessesParSecret.set(nomSecret, promesse);
  }
  return promessesParSecret.get(nomSecret);
}

// À appeler après une rotation de secret (ex. clé de chiffrement) pour forcer
// une relecture depuis Key Vault au prochain appel plutôt que de servir l'ancienne valeur en cache.
function invaliderSecret(nomSecret) {
  promessesParSecret.delete(nomSecret);
}

module.exports = { obtenirSecret, invaliderSecret };
