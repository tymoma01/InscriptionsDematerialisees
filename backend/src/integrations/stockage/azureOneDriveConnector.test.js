const test = require('node:test');
const assert = require('node:assert/strict');

const connecteur = require('./azureOneDriveConnector');

// Ces cas échouent avant tout appel réseau à Graph (validation/parsing en amont),
// donc pas besoin de mocker obtenirClientGraph pour les couvrir.

test('upload rejette un fichier sans nom ou sans contenu Buffer', async () => {
  await assert.rejects(() => connecteur.upload('1', null), /nom.*contenu: Buffer/);
  await assert.rejects(() => connecteur.upload('1', { nom: 'a.txt' }), /nom.*contenu: Buffer/);
  await assert.rejects(() => connecteur.upload('1', { contenu: Buffer.from('x') }), /nom.*contenu: Buffer/);
});

test('download rejette une reference_stockage qui n\'est pas du JSON valide', async () => {
  await assert.rejects(() => connecteur.download('pas-du-json'), /reference_stockage invalide/);
});

test('download rejette une reference_stockage JSON incomplète (driveId ou itemId manquant)', async () => {
  await assert.rejects(() => connecteur.download(JSON.stringify({ driveId: 'x' })), /reference_stockage invalide/);
  await assert.rejects(() => connecteur.download(JSON.stringify({ itemId: 'y' })), /reference_stockage invalide/);
});

test('supprimer rejette une reference_stockage invalide', async () => {
  await assert.rejects(() => connecteur.supprimer('{}'), /reference_stockage invalide/);
});

// --- Tests avec client Graph mocké (aucun appel réseau réel) ---
//
// `promesseDriveId` est mise en cache au niveau du module `azureOneDriveConnector` : on
// recharge le module (et graphClient) à zéro avant chaque test ci-dessous pour garantir
// qu'aucun test ne réutilise un driveId résolu par un test précédent.

const CHEMIN_DRIVES = '/sites/root/drives';
const DRIVE_ID = 'drive-1';
const REPONSE_DRIVES_OK = { valeur: { value: [{ id: DRIVE_ID, name: 'Inscriptions' }] } };

// dateCreation choisie en pleine journée (10h UTC = 12h Paris en juillet, pas de DST à cheval sur
// minuit à gérer ici) pour garder le calcul année/mois trivial à vérifier : 2026/JUILLET.
const DOSSIER_INFO_TEST = {
  id: '42',
  dateCreation: new Date('2026-07-15T10:00:00Z'),
  nomCandidat: 'Dupont',
  prenomCandidat: 'Jean',
};
// Chemin attendu pour DOSSIER_INFO_TEST ci-dessus : {année}/{MOIS_FR_MAJUSCULE}/{NOM_PRENOM}.
const CHEMIN_DOSSIER_CANDIDAT_TEST = '2026/JUILLET/DUPONT_JEAN';

// Construit un faux client Graph : `reponses` associe "METHODE chemin" à { valeur } ou
// { erreur: { statusCode, code } } — imite la forme d'un GraphError (cf. GraphError.js du SDK).
function creerClientMock(reponses) {
  return {
    api(chemin) {
      const executer = (methode, corps) => {
        const gestion = reponses[`${methode} ${chemin}`];
        if (!gestion) {
          throw new Error(`Appel Graph non simulé dans ce test : ${methode} ${chemin}`);
        }
        if (gestion.erreur) {
          const erreur = new Error(gestion.erreur.message || 'erreur Graph simulée');
          erreur.statusCode = gestion.erreur.statusCode;
          erreur.code = gestion.erreur.code;
          throw erreur;
        }
        return typeof gestion.valeur === 'function' ? gestion.valeur(corps) : gestion.valeur;
      };

      const requeteur = {
        responseType: () => requeteur,
        get: async () => executer('GET'),
        put: async (corps) => executer('PUT', corps),
        post: async (corps) => executer('POST', corps),
        delete: async () => executer('DELETE'),
      };
      return requeteur;
    },
  };
}

// Recharge azureOneDriveConnector/graphClient à l'état initial et mocke obtenirClientGraph
// pour qu'il retourne le faux client fourni.
function chargerConnecteurAvecClient(t, clientMock) {
  delete require.cache[require.resolve('./azureOneDriveConnector')];
  delete require.cache[require.resolve('./graphClient')];
  const graphClient = require('./graphClient');
  t.mock.method(graphClient, 'obtenirClientGraph', async () => clientMock);
  return require('./azureOneDriveConnector');
}

test('upload traduit une erreur 401 (token expiré/invalide) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    [`PUT /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}/piece.pdf:/content`]: {
      erreur: { statusCode: 401, code: 'InvalidAuthenticationToken' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.upload(DOSSIER_INFO_TEST, { nom: 'piece.pdf', contenu: Buffer.from('contenu') }),
    /Authentification Microsoft Graph expirée ou invalide/,
  );
});

test('upload traduit une erreur 403 (permissions insuffisantes) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    [`PUT /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}/piece.pdf:/content`]: {
      erreur: { statusCode: 403, code: 'AccessDenied' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.upload(DOSSIER_INFO_TEST, { nom: 'piece.pdf', contenu: Buffer.from('contenu') }),
    /Permissions Microsoft Graph insuffisantes/,
  );
});

test('upload traduit une erreur 409 (fichier déjà existant) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    [`PUT /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}/piece.pdf:/content`]: {
      erreur: { statusCode: 409, code: 'nameAlreadyExists' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.upload(DOSSIER_INFO_TEST, { nom: 'piece.pdf', contenu: Buffer.from('contenu') }),
    /existe déjà/,
  );
});

test('upload puis download effectuent un aller-retour correct (contenu identique)', async (t) => {
  const contenuOriginal = Buffer.from('contenu binaire de test');
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    [`PUT /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}/piece.pdf:/content`]: { valeur: { id: 'item-1' } },
    'GET /drives/drive-1/items/item-1/content': { valeur: contenuOriginal },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  const reference = await connecteurMocke.upload(DOSSIER_INFO_TEST, { nom: 'piece.pdf', contenu: contenuOriginal });
  assert.deepEqual(JSON.parse(reference), { driveId: 'drive-1', itemId: 'item-1' });

  const contenuTelecharge = await connecteurMocke.download(reference);
  assert.deepEqual(contenuTelecharge, contenuOriginal);
});

test('upload normalise NOM_PRENOM : majuscules, accents retirés, espaces (y compris internes au nom) réduits à un seul "_"', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    // "de la Fontaine" + "Héloïse" -> "DE_LA_FONTAINE_HELOISE" : chaque espace (y compris ceux
    // internes à "de la Fontaine") est réduit à un seul "_", tous les accents retirés.
    'PUT /drives/drive-1/root:/2025/FEVRIER/DE_LA_FONTAINE_HELOISE/piece.pdf:/content': {
      valeur: { id: 'item-2' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  const reference = await connecteurMocke.upload(
    {
      id: '99',
      dateCreation: new Date('2025-02-15T10:00:00Z'),
      nomCandidat: 'de la Fontaine',
      prenomCandidat: 'Héloïse',
    },
    { nom: 'piece.pdf', contenu: Buffer.from('contenu') },
  );

  assert.deepEqual(JSON.parse(reference), { driveId: 'drive-1', itemId: 'item-2' });
});

test('upload calcule année/mois dans le fuseau Europe/Paris, pas en UTC (bascule d\'année au réveillon)', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    // 2025-12-31T23:00:00Z = 2026-01-01T00:00 heure de Paris (hiver, UTC+1) : si le calcul se
    // faisait en UTC (ou dans le fuseau du serveur, potentiellement différent), ce dossier
    // tomberait à tort dans "2025/DECEMBRE" plutôt que "2026/JANVIER".
    'PUT /drives/drive-1/root:/2026/JANVIER/DUPONT_JEAN/piece.pdf:/content': {
      valeur: { id: 'item-3' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  const reference = await connecteurMocke.upload(
    {
      id: '100',
      dateCreation: new Date('2025-12-31T23:00:00Z'),
      nomCandidat: 'Dupont',
      prenomCandidat: 'Jean',
    },
    { nom: 'piece.pdf', contenu: Buffer.from('contenu') },
  );

  assert.deepEqual(JSON.parse(reference), { driveId: 'drive-1', itemId: 'item-3' });
});

test('obtenirUrlTemporaire renvoie @microsoft.graph.downloadUrl', async (t) => {
  const client = creerClientMock({
    'GET /drives/drive-1/items/item-1': { valeur: { '@microsoft.graph.downloadUrl': 'https://exemple.test/signe' } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  const url = await connecteurMocke.obtenirUrlTemporaire(JSON.stringify({ driveId: 'drive-1', itemId: 'item-1' }));
  assert.equal(url, 'https://exemple.test/signe');
});

test('obtenirUrlTemporaire échoue si Graph ne renvoie pas de downloadUrl (dossier, pas un fichier)', async (t) => {
  const client = creerClientMock({
    'GET /drives/drive-1/items/item-1': { valeur: {} },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.obtenirUrlTemporaire(JSON.stringify({ driveId: 'drive-1', itemId: 'item-1' })),
    /Aucune URL de téléchargement disponible/,
  );
});

test('obtenirUrlTemporaire traduit une erreur 404 (item introuvable) en message clair', async (t) => {
  const client = creerClientMock({
    'GET /drives/drive-1/items/item-1': { erreur: { statusCode: 404, code: 'itemNotFound' } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.obtenirUrlTemporaire(JSON.stringify({ driveId: 'drive-1', itemId: 'item-1' })),
    /introuvable sur SharePoint/,
  );
});

test('download traduit une erreur 404 (item introuvable) en message clair', async (t) => {
  const client = creerClientMock({
    'GET /drives/drive-1/items/item-1/content': { erreur: { statusCode: 404, code: 'itemNotFound' } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.download(JSON.stringify({ driveId: 'drive-1', itemId: 'item-1' })),
    /introuvable sur SharePoint/,
  );
});

test('supprimer traduit une erreur 403 (permissions insuffisantes) en message clair', async (t) => {
  const client = creerClientMock({
    'DELETE /drives/drive-1/items/item-1': { erreur: { statusCode: 403, code: 'AccessDenied' } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.supprimer(JSON.stringify({ driveId: 'drive-1', itemId: 'item-1' })),
    /Permissions Microsoft Graph insuffisantes/,
  );
});

test('lister retourne un tableau vide si le dossier candidat n\'existe à aucun des deux emplacements (404)', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    // Ancien rangement plat {dossierId}/ ET nouveau {année}/{mois}/{NOM_PRENOM}/ : lister()
    // interroge les deux (voir son commentaire) pour ne rien perdre des pièces déjà envoyées à
    // l'un ou l'autre emplacement.
    [`GET /drives/drive-1/root:/${DOSSIER_INFO_TEST.id}:/children`]: { erreur: { statusCode: 404, code: 'itemNotFound' } },
    [`GET /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}:/children`]: { erreur: { statusCode: 404, code: 'itemNotFound' } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  assert.deepEqual(await connecteurMocke.lister(DOSSIER_INFO_TEST), []);
});

test('lister fusionne les pièces trouvées à l\'ancien emplacement et au nouveau', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    [`GET /drives/drive-1/root:/${DOSSIER_INFO_TEST.id}:/children`]: { valeur: { value: [{ id: 'item-ancien' }] } },
    [`GET /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}:/children`]: { valeur: { value: [{ id: 'item-nouveau' }] } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  const references = await connecteurMocke.lister(DOSSIER_INFO_TEST);
  assert.deepEqual(
    references.map((reference) => JSON.parse(reference)),
    [
      { driveId: 'drive-1', itemId: 'item-ancien' },
      { driveId: 'drive-1', itemId: 'item-nouveau' },
    ],
  );
});

test('lister traduit une erreur 429 (limite de débit) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    [`GET /drives/drive-1/root:/${DOSSIER_INFO_TEST.id}:/children`]: { erreur: { statusCode: 429 } },
    [`GET /drives/drive-1/root:/${CHEMIN_DOSSIER_CANDIDAT_TEST}:/children`]: { erreur: { statusCode: 429 } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(() => connecteurMocke.lister(DOSSIER_INFO_TEST), /Limite de débit Microsoft Graph atteinte/);
});
