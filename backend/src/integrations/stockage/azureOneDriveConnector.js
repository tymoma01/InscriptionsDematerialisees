const { ResponseType } = require('@microsoft/microsoft-graph-client');
const StorageConnector = require('./StorageConnector');
// Non déstructuré exprès : les tests mockent `graphClient.obtenirClientGraph` via
// `t.mock.method`, ce qui ne fonctionne que si l'appel passe par la propriété du module
// (une déstructuration figerait la référence à l'implémentation réelle dès le require).
const graphClient = require('./graphClient');
const { traduireErreurGraph } = require('./erreursGraph');

// Bibliothèque de documents cible pour ACCECIT, sur le site SharePoint racine du tenant (vérifié :
// /sites/root résout bien sur le site nommé "Communication site" utilisé par Florence, même site,
// aucun siteId à cibler explicitement). Si une future entité utilise elle aussi OneDrive/SharePoint
// avec une bibliothèque différente, faire de ce nom une valeur de configuration par entité plutôt
// que d'ajouter un branchement ici.
const NOM_BIBLIOTHEQUE = 'Inscriptions';

// Mois FR en majuscules sans accent (contrainte d'encodage SharePoint), indexés comme
// Date#getMonth()/Intl (0 = janvier).
const MOIS_FR_MAJUSCULE = [
  'JANVIER',
  'FEVRIER',
  'MARS',
  'AVRIL',
  'MAI',
  'JUIN',
  'JUILLET',
  'AOUT',
  'SEPTEMBRE',
  'OCTOBRE',
  'NOVEMBRE',
  'DECEMBRE',
];

// Caractères interdits dans un nom de dossier/fichier SharePoint.
const CARACTERES_INTERDITS_SHAREPOINT = /[/\\:*?"<>|]/g;

// Année/mois calculés dans le fuseau Europe/Paris (jamais celui, potentiellement différent, du
// serveur applicatif) : sans ça, un dossier créé juste après minuit heure de Paris pourrait
// tomber dans le mauvais mois — voire la mauvaise année pour la nuit du 31 décembre — si le
// serveur tourne en UTC ou dans un autre fuseau.
function anneeMoisParis(date) {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const annee = parties.find((partie) => partie.type === 'year').value;
  const moisIndex = Number(parties.find((partie) => partie.type === 'month').value) - 1;
  return { annee, mois: MOIS_FR_MAJUSCULE[moisIndex] };
}

// Construit le segment de dossier "NOM_PRENOM" du candidat : majuscules, accents retirés
// (décomposition NFD puis suppression des marques diacritiques), caractères interdits SharePoint
// retirés, espaces (un ou plusieurs) réduits à un seul "_" — jamais d'espace ni d'accent dans un
// nom de dossier SharePoint généré automatiquement.
// \p{Mn} (Unicode property escape, nécessite le flag "u") : catégorie "Mark, nonspacing" — couvre
// toutes les marques diacritiques qu'une décomposition NFD peut produire, sans dépendre d'une
// plage de code points écrite en dur.
const MARQUES_DIACRITIQUES = /\p{Mn}/gu;

function normaliserSegmentDossierCandidat(nom, prenom) {
  return `${nom} ${prenom}`
    .toUpperCase()
    .normalize('NFD')
    .replace(MARQUES_DIACRITIQUES, '')
    .replace(CARACTERES_INTERDITS_SHAREPOINT, '')
    .trim()
    .replace(/\s+/g, '_');
}

// Chemin (sans nom de fichier) de la nouvelle arborescence, demandée pour classer les pièces par
// période et par candidat plutôt que par simple id de dossier technique.
function cheminDossierCandidat(dossierInfo) {
  const { annee, mois } = anneeMoisParis(dossierInfo.dateCreation);
  const segmentCandidat = normaliserSegmentDossierCandidat(dossierInfo.nomCandidat, dossierInfo.prenomCandidat);
  return `${annee}/${mois}/${segmentCandidat}`;
}

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

// Liste le contenu d'un seul chemin, [] si le dossier n'existe pas (rien uploadé à cet
// emplacement) — factorisé pour lister() ci-dessous, qui interroge deux emplacements possibles.
async function listerItemsChemin(client, driveId, chemin, dossierId) {
  try {
    const reponse = await client.api(`/drives/${driveId}/root:/${encoderChemin(chemin)}:/children`).get();
    return reponse.value.map((item) => encoderReference(driveId, item.id));
  } catch (erreur) {
    if (erreur.statusCode === 404) {
      return []; // aucun dossier créé à cet emplacement = aucune pièce justificative ici
    }
    throw traduireErreurGraph(erreur, `listing du dossier "${dossierId}"`);
  }
}

class AzureOneDriveConnector extends StorageConnector {
  async upload(dossierInfo, fichier) {
    if (!fichier || typeof fichier.nom !== 'string' || !Buffer.isBuffer(fichier.contenu)) {
      throw new Error('upload attend un fichier { nom: string, contenu: Buffer }');
    }

    const client = await graphClient.obtenirClientGraph();
    const driveId = await obtenirDriveId(client);
    const chemin = encoderChemin(`${cheminDossierCandidat(dossierInfo)}/${fichier.nom}`);

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

  // `@microsoft.graph.downloadUrl` : URL pré-authentifiée générée par Graph, valide ~1h, ne
  // nécessitant aucun jeton pour être suivie — jamais de lien public permanent sur l'item lui-même
  // (celui-ci reste privé, seule cette URL temporaire y donne accès).
  async obtenirUrlTemporaire(referenceStockage) {
    const { driveId, itemId } = decoderReference(referenceStockage);
    const client = await graphClient.obtenirClientGraph();

    // Pas de `.select(...)` : Graph inclut `@microsoft.graph.downloadUrl` par défaut dans la
    // réponse d'un GET sur un driveItem fichier, sans restriction de champs nécessaire ici.
    let item;
    try {
      item = await client.api(`/drives/${driveId}/items/${itemId}`).get();
    } catch (erreur) {
      throw traduireErreurGraph(erreur, `obtention de l'URL de téléchargement temporaire de l'item "${itemId}"`);
    }

    if (!item['@microsoft.graph.downloadUrl']) {
      throw new Error(`Aucune URL de téléchargement disponible pour l'item "${itemId}" (fichier introuvable ou dossier).`);
    }
    return item['@microsoft.graph.downloadUrl'];
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

  // Interroge à la fois l'ancien rangement plat {dossierId}/ (pièces uploadées avant
  // l'introduction de l'arborescence année/mois/candidat, jamais migrées rétroactivement — voir
  // le plan validé pour ce chantier) et le nouveau {année}/{mois}/{NOM_PRENOM}/ (uploads
  // courants), pour ne perdre aucune pièce déjà envoyée à l'un ou l'autre emplacement.
  async lister(dossierInfo) {
    const client = await graphClient.obtenirClientGraph();
    const driveId = await obtenirDriveId(client);

    const [itemsAncienChemin, itemsNouveauChemin] = await Promise.all([
      listerItemsChemin(client, driveId, String(dossierInfo.id), dossierInfo.id),
      listerItemsChemin(client, driveId, cheminDossierCandidat(dossierInfo), dossierInfo.id),
    ]);

    return [...itemsAncienChemin, ...itemsNouveauChemin];
  }
}

module.exports = new AzureOneDriveConnector();
