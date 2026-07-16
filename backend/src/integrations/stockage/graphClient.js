const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');
const { ClientSecretCredential } = require('@azure/identity');
const { obtenirSecret } = require('../../core/securite/keyVaultClient');

let promesseClient;

// Credentials de l'app registration Graph (service principal ACCECIT), stockées dans
// Azure Key Vault (SecretsForInscriptions) — distinctes de l'identité utilisée pour accéder au Vault lui-même.
async function obtenirClientGraph() {
  if (!promesseClient) {
    promesseClient = (async () => {
      const [clientId, clientSecret, tenantId] = await Promise.all([
        obtenirSecret('graph-client-id'),
        obtenirSecret('graph-client-secret'),
        obtenirSecret('graph-tenant-id'),
      ]);

      const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
      const authProvider = new TokenCredentialAuthenticationProvider(credential, {
        scopes: ['https://graph.microsoft.com/.default'],
      });

      return Client.initWithMiddleware({ authProvider });
    })();
  }
  return promesseClient;
}

module.exports = { obtenirClientGraph };
