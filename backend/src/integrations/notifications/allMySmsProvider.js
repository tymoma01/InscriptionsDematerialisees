const axios = require('axios');
const NotificationProvider = require('./NotificationProvider');
const { ALLMYSMS_API_LOGIN, ALLMYSMS_API_PASSWORD } = require('../../config/env');

// ATTENTION — contrat d'API non vérifié : ce fichier implémente NotificationProvider avec la
// forme d'API la plus courante pour ce type de prestataire (endpoint HTTP + login/mot de passe
// de compte), mais aucun accès ni documentation officielle AllMySMS n'a été consulté pour ce
// chantier — même statut que le mapping SmartOF ("détails à documenter séparément", voir
// docs/architecture-technique.md §3.2/§3.3). À vérifier/ajuster avec la documentation API
// AllMySMS réelle (endpoints exacts, forme de la réponse, gestion des erreurs prestataire) avant
// toute mise en production — ne pas activer `entites.sms_actif` en prod avant cette vérification.
const BASE_URL = 'https://api.allmysms.com/http/9.0';

class AllMySmsProvider extends NotificationProvider {
  async envoyer(destinataire, canal, message) {
    if (!ALLMYSMS_API_LOGIN || !ALLMYSMS_API_PASSWORD) {
      throw new Error('Identifiants AllMySMS absents (ALLMYSMS_API_LOGIN / ALLMYSMS_API_PASSWORD).');
    }

    const chemin = canal === 'email' ? '/email.do' : '/sms.do';
    const destinataireChamp = canal === 'email' ? 'email' : 'numero';

    try {
      const reponse = await axios.post(`${BASE_URL}${chemin}`, {
        login: ALLMYSMS_API_LOGIN,
        password: ALLMYSMS_API_PASSWORD,
        [destinataireChamp]: destinataire,
        message,
      });

      if (reponse.data?.erreur) {
        throw new Error(`AllMySMS a refusé l'envoi : ${reponse.data.erreur}`);
      }
    } catch (erreur) {
      if (erreur.response) {
        throw new Error(`AllMySMS a répondu une erreur HTTP ${erreur.response.status}.`);
      }
      throw erreur;
    }
  }
}

module.exports = new AllMySmsProvider();
