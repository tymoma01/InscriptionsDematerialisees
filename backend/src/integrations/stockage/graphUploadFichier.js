const { traduireErreurGraph } = require('./erreursGraph');

// Limite de l'upload simple (PUT .../content) côté Microsoft Graph : 4 Mio. Au-delà, obligation
// de passer par une upload session (envoi par tranches), sans quoi la requête échoue. Extrait
// d'azureOneDriveConnector.js pour être partagé par tout appelant Graph qui téléverse un fichier
// dans un drive (pièces justificatives, sauvegardes Neon...).
const SEUIL_UPLOAD_SIMPLE_OCTETS = 4 * 1024 * 1024;
// Taille de tranche recommandée par Microsoft (doit être un multiple de 320 Kio) pour l'upload par tranches.
const TAILLE_TRANCHE_OCTETS = 5 * 1024 * 1024;

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

// Point d'entrée unique : bascule automatiquement simple/par tranches selon la taille du contenu.
async function uploaderFichier(client, driveId, chemin, contenu) {
  return contenu.length <= SEUIL_UPLOAD_SIMPLE_OCTETS
    ? uploaderPetitFichier(client, driveId, chemin, contenu)
    : uploaderGrosFichier(client, driveId, chemin, contenu);
}

module.exports = { uploaderFichier };
