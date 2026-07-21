/**
 * Contrat commun à tout prestataire de notification (voir docs/architecture-technique.md §3.3).
 * Une entité choisit son canal via `entites.canal_rappel` ('sms' | 'email') — aucun module
 * métier n'importe une implémentation concrète directement, même principe que StorageConnector
 * pour le stockage documentaire.
 */
class NotificationProvider {
  /**
   * @param {string} destinataire — numéro de téléphone (canal 'sms') ou adresse email (canal 'email')
   * @param {'sms'|'email'} canal
   * @param {string} message
   * @returns {Promise<void>}
   */
  async envoyer(destinataire, canal, message) {
    throw new Error('NotificationProvider.envoyer doit être implémenté par la classe dérivée');
  }
}

module.exports = NotificationProvider;
