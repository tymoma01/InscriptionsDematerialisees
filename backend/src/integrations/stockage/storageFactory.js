const azureOneDriveConnector = require('./azureOneDriveConnector');

/**
 * Sélectionne l'implémentation StorageConnector à partir de `entites.connecteur_stockage`.
 * Aucun module métier ne doit importer azureOneDriveConnector/ovhConnector directement —
 * tout passe par cette factory (voir docs/architecture-technique.md §2.2).
 */
function storageFactory(codeConnecteur) {
  switch (codeConnecteur) {
    case 'azure_onedrive':
      return azureOneDriveConnector;
    case 'ovh':
      // Choix S3-compatible vs API native OVH non tranché (cf. .env.example) — connecteur non
      // implémenté à ce stade, contrairement à azure_onedrive.
      throw new Error('Connecteur "ovh" pas encore implémenté');
    default:
      throw new Error(`Connecteur de stockage inconnu : "${codeConnecteur}"`);
  }
}

module.exports = storageFactory;
