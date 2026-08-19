const { ResponseType } = require('@microsoft/microsoft-graph-client');
const graphClient = require('../../integrations/stockage/graphClient');
const { traduireErreurGraph } = require('../../integrations/stockage/erreursGraph');
const { uploaderFichier } = require('../../integrations/stockage/graphUploadFichier');

// Même bibliothèque documentaire que les pièces justificatives (voir azureOneDriveConnector.js),
// dans un dossier "Backups/neon" dédié pour ne jamais mélanger sauvegardes techniques de la base
// et documents candidats. Les sauvegardes ne sont pas propres à une entité (une seule base Neon
// partagée, voir CLAUDE.md) : ce module n'utilise donc pas storageFactory.js/StorageConnector
// (sélection par entité), il appelle directement Graph avec les mêmes credentials déjà en place.
const NOM_BIBLIOTHEQUE = 'Inscriptions';
const DOSSIER_SAUVEGARDES = 'Backups/neon';

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

function encoderChemin(chemin) {
  return chemin.split('/').map(encodeURIComponent).join('/');
}

/**
 * Téléverse le contenu chiffré d'une sauvegarde sous Backups/neon/{nomFichier}.
 */
async function uploaderSauvegarde(nomFichier, contenu) {
  const client = await graphClient.obtenirClientGraph();
  const driveId = await obtenirDriveId(client);
  const chemin = encoderChemin(`${DOSSIER_SAUVEGARDES}/${nomFichier}`);

  await uploaderFichier(client, driveId, chemin, contenu);
}

/**
 * Liste les sauvegardes déjà présentes, triées de la plus récente à la plus ancienne — utilisé par
 * sauvegardeService.js pour appliquer la politique de rétention (30 derniers dumps).
 * @returns {Promise<{id: string, nom: string, dateCreation: Date}[]>}
 */
async function listerSauvegardes() {
  const client = await graphClient.obtenirClientGraph();
  const driveId = await obtenirDriveId(client);

  let reponse;
  try {
    reponse = await client.api(`/drives/${driveId}/root:/${encoderChemin(DOSSIER_SAUVEGARDES)}:/children`).get();
  } catch (erreur) {
    if (erreur.statusCode === 404) {
      return []; // dossier pas encore créé = aucune sauvegarde envoyée
    }
    throw traduireErreurGraph(erreur, 'listing du dossier de sauvegardes');
  }

  return reponse.value
    .filter((item) => Boolean(item.file))
    .map((item) => ({ id: item.id, nom: item.name, dateCreation: new Date(item.createdDateTime) }))
    .sort((a, b) => b.dateCreation - a.dateCreation);
}

async function telechargerSauvegarde(itemId) {
  const client = await graphClient.obtenirClientGraph();
  const driveId = await obtenirDriveId(client);

  try {
    const arrayBuffer = await client
      .api(`/drives/${driveId}/items/${itemId}/content`)
      .responseType(ResponseType.ARRAYBUFFER)
      .get();
    return Buffer.from(arrayBuffer);
  } catch (erreur) {
    throw traduireErreurGraph(erreur, `téléchargement de la sauvegarde "${itemId}"`);
  }
}

async function supprimerSauvegarde(itemId) {
  const client = await graphClient.obtenirClientGraph();
  const driveId = await obtenirDriveId(client);

  try {
    await client.api(`/drives/${driveId}/items/${itemId}`).delete();
  } catch (erreur) {
    if (erreur.statusCode === 404 || erreur.code === 'itemNotFound') {
      return; // déjà absent : objectif atteint, voir azureOneDriveConnector.js pour la même tolérance
    }
    throw traduireErreurGraph(erreur, `suppression de la sauvegarde "${itemId}"`);
  }
}

module.exports = { uploaderSauvegarde, listerSauvegardes, telechargerSauvegarde, supprimerSauvegarde };
