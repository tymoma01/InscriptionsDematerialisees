const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

const VAULT_URL = 'https://secretsforinscriptions.vault.azure.net';
const NOM_SECRET_CONNECTION_STRING = 'neon-connection-string';

let promesseConnectionString;

// DefaultAzureCredential utilise `az login` en local et une Managed Identity en production —
// aucune variable d'environnement à renseigner pour l'authentification au Key Vault.
function obtenirConnectionString() {
  if (!promesseConnectionString) {
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(VAULT_URL, credential);
    promesseConnectionString = client
      .getSecret(NOM_SECRET_CONNECTION_STRING)
      .then((secret) => secret.value);
  }
  return promesseConnectionString;
}

module.exports = { obtenirConnectionString };
