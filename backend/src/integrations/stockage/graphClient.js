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
    // Ne pas garder en cache une construction en échec (même principe que keyVaultClient.js,
    // obtenirSecret) : audit 2026-08-27, sans ce filet un échec transitoire (Key Vault ou
    // Microsoft injoignable un court instant) restait cassé pour toute la durée de vie du
    // process — chaque appel suivant au calendrier hebdomadaire aurait échoué à l'identique
    // jusqu'au prochain redémarrage du serveur, même une fois le réseau redevenu disponible.
    promesseClient.catch(() => {
      promesseClient = undefined;
    });
  }
  return promesseClient;
}

module.exports = { obtenirClientGraph };
