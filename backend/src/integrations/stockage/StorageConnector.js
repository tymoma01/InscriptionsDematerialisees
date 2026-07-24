/**
 * Contrat commun à tout connecteur de stockage documentaire (voir docs/architecture-technique.md §2.1).
 * Une entité choisit son implémentation via `entites.connecteur_stockage` et `storageFactory.js` —
 * aucun module métier n'importe une implémentation concrète directement.
 */
class StorageConnector {
  /**
   * dossierInfo porte de quoi construire un rangement lisible/organisé côté prestataire (ex.
   * {année}/{mois}/{NOM_PRENOM} chez Azure OneDrive) — chaque connecteur reste seul responsable
   * de la construction et de la normalisation de son propre chemin.
   * @param {{ id: number|string, dateCreation: Date, nomCandidat: string, prenomCandidat: string }} dossierInfo
   * @param {{ nom: string, contenu: Buffer }} fichier
   * @returns {Promise<string>} reference_stockage à persister dans pieces_justificatives
   */
  async upload(dossierInfo, fichier) {
    throw new Error('StorageConnector.upload doit être implémenté par la classe dérivée');
  }

  /**
   * @param {string} referenceStockage
   * @returns {Promise<Buffer>}
   */
  async download(referenceStockage) {
    throw new Error('StorageConnector.download doit être implémenté par la classe dérivée');
  }

  /**
   * @param {string} referenceStockage
   * @returns {Promise<void>}
   */
  async supprimer(referenceStockage) {
    throw new Error('StorageConnector.supprimer doit être implémenté par la classe dérivée');
  }

  /**
   * @param {{ id: number|string, dateCreation: Date, nomCandidat: string, prenomCandidat: string }} dossierInfo
   * @returns {Promise<string[]>} liste de references_stockage
   */
  async lister(dossierInfo) {
    throw new Error('StorageConnector.lister doit être implémenté par la classe dérivée');
  }

  /**
   * URL de téléchargement temporaire et pré-authentifiée vers le fichier (jamais un lien public
   * permanent) — à préférer à `download()` quand le fichier peut être servi directement au
   * navigateur du candidat/recruteur sans transiter par le serveur applicatif.
   * @param {string} referenceStockage
   * @returns {Promise<string>} URL signée, à durée de vie limitée (dépend du prestataire)
   */
  async obtenirUrlTemporaire(referenceStockage) {
    throw new Error('StorageConnector.obtenirUrlTemporaire doit être implémenté par la classe dérivée');
  }
}

module.exports = StorageConnector;
