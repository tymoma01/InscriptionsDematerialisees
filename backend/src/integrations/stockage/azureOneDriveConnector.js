const { ResponseType } = require('@microsoft/microsoft-graph-client');
const StorageConnector = require('./StorageConnector');
// Non déstructuré exprès : les tests mockent `graphClient.obtenirClientGraph` via
// `t.mock.method`, ce qui ne fonctionne que si l'appel passe par la propriété du module
// (une déstructuration figerait la référence à l'implémentation réelle dès le require).
const graphClient = require('./graphClient');
const { traduireErreurGraph } = require('./erreursGraph');

// Bibliothèque de documents cible pour ACCECIT, sur le site SharePoint racine du tenant.
// Si une future entité utilise elle aussi OneDrive/SharePoint avec une bibliothèque différente,
// faire de ce nom une valeur de configuration par entité plutôt que d'ajouter un branchement ici.
const NOM_BIBLIOTHEQUE = 'Inscriptions';

// Limite de l'upload simple (PUT .../content) côté Microsoft Graph : 4 Mio. Au-delà, obligation
// de passer par une upload session (envoi par tranches), sans quoi la requête échoue.
const SEUIL_UPLOAD_SIMPLE_OCTETS = 4 * 1024 * 1024;
// Taille de tranche recommandée par Microsoft (doit être un multiple de 320 Kio) pour l'upload par tranches.
const TAILLE_TRANCHE_OCTETS = 5 * 1024 * 1024;

let promesseDriveId;

async function obtenirDriveId(client) {
  if (!promesseDriveId) {
    promesseDriveId = (async () => {
      let reponse;
      try {
        reponse = await client.api('/sites/root/drives').get();
      } catch (erreur) {
        throw traduireErreurGraph(erreur, 'résolution de la bibliothèque de documents');
      }
      const drive = reponse.value.find((d) => d.name === NOM_BIBLIOTHEQUE);
      if (!drive) {
        throw new Error(`Bibliothèque de documents "${NOM_BIBLIOTHEQUE}" introuvable sur le site SharePoint racine`);
      }
      return drive.id;
    })();
    promesseDriveId.catch(() => {
      promesseDriveId = undefined;
    });
  }
  return promesseDriveId;
}

function encoderReference(driveId, itemId) {
  return JSON.stringify({ driveId, itemId });
}

function decoderReference(referenceStockage) {
  let driveId;
  let itemId;
  try {
    ({ driveId, itemId } = JSON.parse(referenceStockage));
    if (!driveId || !itemId) {
      throw new Error('champs manquants');
    }
  } catch {
    throw new Error('reference_stockage invalide (attendu : JSON avec les champs driveId/itemId)');
  }
  return { driveId, itemId };
}

// Encode chaque segment du chemin individuellement (jamais les "/" séparateurs),
// pour supporter des noms de dossier/fichier avec espaces, accents, etc.
function encoderChemin(chemin) {
  return chemin.split('/').map(encodeURIComponent).join('/');
}

async function uploaderPetitFichier(client, driveId, chemin, contenu) {
  try {
    return await client.api(`/drives/${driveId}/root:/${chemin}:/content`).put(contenu);
  } catch (erreur) {
    throw traduireErreurGraph(erreur, `upload de "${chemin}"`);
  }
}

// Upload par tranches (obligatoire au-delà de 4 Mio) : ouvre une session, envoie le contenu
// par blocs de TAILLE_TRANCHE_OCTETS vers l'uploadUrl pré-authentifiée renvoyée par Graph
// (fetch direct, sans passer par le client Graph — cette URL porte sa propre autorisation).
async function uploaderGrosFichier(client, driveId, chemin, contenu) {
  let session;
  try {
    session = await client.api(`/drives/${driveId}/root:/${chemin}:/createUploadSession`).post({
      item: { '@microsoft.graph.conflictBehavior': 'replace' },
    });
  } catch (erreur) {
    throw traduireErreurGraph(erreur, `ouverture de la session d'upload pour "${chemin}"`);
  }

  const taille = contenu.length;
  let itemFinal;

  for (let debut = 0; debut < taille; debut += TAILLE_TRANCHE_OCTETS) {
    const fin = Math.min(debut + TAILLE_TRANCHE_OCTETS, taille);
    const tranche = contenu.subarray(debut, fin);

    const reponse = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(tranche.length),
        'Content-Range': `bytes ${debut}-${fin - 1}/${taille}`,
      },
      body: tranche,
    });

    if (!reponse.ok) {
      throw new Error(`Échec de l'envoi par tranches vers OneDrive (statut HTTP ${reponse.status})`);
    }
    if (reponse.status === 200 || reponse.status === 201) {
      itemFinal = await reponse.json();
    }
  }

  if (!itemFinal) {
    throw new Error("Upload par tranches terminé sans réponse finale contenant l'item créé");
  }
  return itemFinal;
}

class AzureOneDriveConnector extends StorageConnector {
  async upload(dossierId, fichier) {
    if (!fichier || typeof fichier.nom !== 'string' || !Buffer.isBuffer(fichier.contenu)) {
      throw new Error('upload attend un fichier { nom: string, contenu: Buffer }');
    }

    const client = await graphClient.obtenirClientGraph();
    const driveId = await obtenirDriveId(client);
    const chemin = encoderChemin(`${dossierId}/${fichier.nom}`);

    const item =
      fichier.contenu.length <= SEUIL_UPLOAD_SIMPLE_OCTETS
        ? await uploaderPetitFichier(client, driveId, chemin, fichier.contenu)
        : await uploaderGrosFichier(client, driveId, chemin, fichier.contenu);

    return encoderReference(driveId, item.id);
  }

  async download(referenceStockage) {
    const { driveId, itemId } = decoderReference(referenceStockage);
    const client = await graphClient.obtenirClientGraph();

    try {
      // ResponseType.ARRAYBUFFER est indispensable ici : sans lui, le client Graph tente de
      // décoder la réponse comme du texte UTF-8 et corrompt tout contenu binaire (PDF, image...).
      const arrayBuffer = await client
        .api(`/drives/${driveId}/items/${itemId}/content`)
        .responseType(ResponseType.ARRAYBUFFER)
        .get();

      return Buffer.from(arrayBuffer);
    } catch (erreur) {
      throw traduireErreurGraph(erreur, `téléchargement de l'item "${itemId}"`);
    }
  }

  async supprimer(referenceStockage) {
    const { driveId, itemId } = decoderReference(referenceStockage);
    const client = await graphClient.obtenirClientGraph();
    try {
      await client.api(`/drives/${driveId}/items/${itemId}`).delete();
    } catch (erreur) {
      throw traduireErreurGraph(erreur, `suppression de l'item "${itemId}"`);
    }
  }

  async lister(dossierId) {
    const client = await graphClient.obtenirClientGraph();
    const driveId = await obtenirDriveId(client);

    try {
      const reponse = await client.api(`/drives/${driveId}/root:/${encoderChemin(String(dossierId))}:/children`).get();
      return reponse.value.map((item) => encoderReference(driveId, item.id));
    } catch (erreur) {
      if (erreur.statusCode === 404) {
        return []; // aucun dossier créé pour ce candidat = aucune pièce justificative
      }
      throw traduireErreurGraph(erreur, `listing du dossier "${dossierId}"`);
    }
  }
}

module.exports = new AzureOneDriveConnector();
