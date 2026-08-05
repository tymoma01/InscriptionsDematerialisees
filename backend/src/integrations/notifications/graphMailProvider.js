const NotificationProvider = require('./NotificationProvider');
// Réutilise l'authentification Graph déjà en place pour SharePoint/OneDrive (même app
// registration, mêmes secrets Key Vault graph-client-id/graph-client-secret/graph-tenant-id) —
// dupliquer la récupération des secrets/le ClientSecretCredential ici referait exactement ce que
// graphClient.js fait déjà. Nécessite d'ajouter la permission d'application "Mail.Send" (consentement
// admin) à cette app registration, en plus de "Files.ReadWrite.All" déjà accordée pour le stockage.
// Non déstructuré exprès, même raison que azureOneDriveConnector.js : les tests mockent
// `graphClient.obtenirClientGraph` via `t.mock.method`, qui ne fonctionne que si l'appel passe par
// la propriété du module (une déstructuration figerait la référence dès le require).
const graphClient = require('../stockage/graphClient');
const { traduireErreurGraph } = require('../stockage/erreursGraph');

// Boîte mail ACCECIT dédiée aux notifications candidats, décision actée le 2026-08-05 (remplace
// AllMySMS pour le canal email — leur seul service proche, Mail2SMS, fait l'inverse : convertir un
// email en SMS, aucun envoi d'email réel proposé, voir docs/architecture-technique.md §3.3).
// En dur pour ACCECIT, comme NOM_BIBLIOTHEQUE dans azureOneDriveConnector.js : si une future entité
// utilise elle aussi Microsoft Graph pour ses emails avec une autre boîte d'expédition, en faire une
// valeur de configuration par entité plutôt que d'ajouter un branchement ici (voir Modularité, CLAUDE.md).
const BOITE_EXPEDITRICE = 'inscriptions@accecit.com';

// Permission Graph à vérifier en cas de 403 (voir erreursGraph.js) — distincte de
// "Files.ReadWrite.All" utilisée par le connecteur de stockage sur cette même app registration.
const PERMISSION_GRAPH_MAIL = 'Mail.Send';

function construirePieceJointeGraph(piece) {
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: piece.nom,
    contentType: piece.typeMime,
    contentBytes: piece.contenu.toString('base64'),
  };
}

// Implémente NotificationProvider pour le seul canal 'email' — notificationFactory.js ne
// l'invoque jamais pour 'sms' (resté sur allMySmsProvider.js), la vérification ci-dessous n'est
// qu'un filet de sécurité si ce module était un jour appelé directement par erreur.
class GraphMailProvider extends NotificationProvider {
  async envoyer(destinataire, canal, message, options = {}) {
    if (canal !== 'email') {
      throw new Error(`GraphMailProvider ne gère que le canal 'email' (reçu : "${canal}").`);
    }

    const client = await graphClient.obtenirClientGraph();

    const messageGraph = {
      subject: options.sujet ?? '',
      // 'Text' et non 'HTML' : tous les corps d'email de ce projet (construireMessageEmail,
      // construireMessageRelance...) sont du texte brut avec des \n littéraux, jamais du HTML.
      body: { contentType: 'Text', content: message },
      toRecipients: [{ emailAddress: { address: destinataire } }],
    };

    if (options.piecesJointes?.length > 0) {
      messageGraph.attachments = options.piecesJointes.map(construirePieceJointeGraph);
    }

    try {
      await client.api(`/users/${BOITE_EXPEDITRICE}/sendMail`).post({
        message: messageGraph,
        saveToSentItems: true,
      });
    } catch (erreur) {
      throw traduireErreurGraph(erreur, `envoi d'email à "${destinataire}"`, { permission: PERMISSION_GRAPH_MAIL });
    }
  }
}

module.exports = new GraphMailProvider();
