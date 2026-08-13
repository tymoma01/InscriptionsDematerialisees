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
   * @param {{ sujet?: string, piecesJointes?: Array<{ nom: string, contenu: Buffer, typeMime: string }>, html?: boolean }} [options]
   *   — sujet, piecesJointes et html n'ont de sens que pour le canal 'email' (ex. invitation au
   *   test avec un fichier .ics joint, voir invitationTestService.js) ; une implémentation doit
   *   les ignorer silencieusement pour le canal 'sms'. `html: true` indique que `message` est déjà
   *   du HTML (balises <p>/<br>, voir formatageEmail.js) plutôt que du texte brut avec des \n
   *   littéraux — par défaut (`html` absent/false), `message` reste interprété comme texte brut,
   *   comportement historique de rappelService.js/relanceService.js. Paramètre optionnel : les
   *   appelants existants restent valides sans le fournir.
   * @returns {Promise<void>}
   */
  async envoyer(destinataire, canal, message, options = {}) {
    throw new Error('NotificationProvider.envoyer doit être implémenté par la classe dérivée');
  }
}

module.exports = NotificationProvider;
