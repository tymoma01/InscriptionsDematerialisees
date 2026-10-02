const azureOneDriveConnector = require('./azureOneDriveConnector');

/**
 * Sélectionne l'implémentation StorageConnector à partir de `entites.connecteur_stockage`.
 * Aucun module métier ne doit importer azureOneDriveConnector directement —
 * tout passe par cette factory (voir docs/architecture-technique.md §2.2).
 */
function storageFactory(codeConnecteur) {
  switch (codeConnecteur) {
    case 'azure_onedrive':
      return azureOneDriveConnector;
    default:
      throw new Error(`Connecteur de stockage inconnu : "${codeConnecteur}"`);
  }
}

module.exports = storageFactory;
