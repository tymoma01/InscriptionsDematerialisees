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
    promessesParSecret.set(
      nomSecret,
      obtenirClient()
        .getSecret(nomSecret)
        .then((secret) => secret.value)
    );
  }
  return promessesParSecret.get(nomSecret);
}

module.exports = { obtenirSecret };
