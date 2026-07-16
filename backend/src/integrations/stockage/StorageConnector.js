/**
 * Contrat commun à tout connecteur de stockage documentaire (voir docs/architecture-technique.md §2.1).
 * Une entité choisit son implémentation via `entites.connecteur_stockage` et `storageFactory.js` —
 * aucun module métier n'importe une implémentation concrète directement.
 */
class StorageConnector {
  /**
   * @param {number|string} dossierId
   * @param {{ nom: string, contenu: Buffer }} fichier
   * @returns {Promise<string>} reference_stockage à persister dans pieces_justificatives
   */
  async upload(dossierId, fichier) {
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
   * @param {number|string} dossierId
   * @returns {Promise<string[]>} liste de references_stockage
   */
  async lister(dossierId) {
    throw new Error('StorageConnector.lister doit être implémenté par la classe dérivée');
  }
}

module.exports = StorageConnector;
