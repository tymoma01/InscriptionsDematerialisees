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
    'PUT /drives/drive-1/root:/42/piece.pdf:/content': {
      erreur: { statusCode: 401, code: 'InvalidAuthenticationToken' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.upload('42', { nom: 'piece.pdf', contenu: Buffer.from('contenu') }),
    /Authentification Microsoft Graph expirée ou invalide/,
  );
});

test('upload traduit une erreur 403 (permissions insuffisantes) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    'PUT /drives/drive-1/root:/42/piece.pdf:/content': {
      erreur: { statusCode: 403, code: 'AccessDenied' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.upload('42', { nom: 'piece.pdf', contenu: Buffer.from('contenu') }),
    /Permissions Microsoft Graph insuffisantes/,
  );
});

test('upload traduit une erreur 409 (fichier déjà existant) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    'PUT /drives/drive-1/root:/42/piece.pdf:/content': {
      erreur: { statusCode: 409, code: 'nameAlreadyExists' },
    },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(
    () => connecteurMocke.upload('42', { nom: 'piece.pdf', contenu: Buffer.from('contenu') }),
    /existe déjà/,
  );
});

test('upload puis download effectuent un aller-retour correct (contenu identique)', async (t) => {
  const contenuOriginal = Buffer.from('contenu binaire de test');
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    'PUT /drives/drive-1/root:/42/piece.pdf:/content': { valeur: { id: 'item-1' } },
    'GET /drives/drive-1/items/item-1/content': { valeur: contenuOriginal },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  const reference = await connecteurMocke.upload('42', { nom: 'piece.pdf', contenu: contenuOriginal });
  assert.deepEqual(JSON.parse(reference), { driveId: 'drive-1', itemId: 'item-1' });

  const contenuTelecharge = await connecteurMocke.download(reference);
  assert.deepEqual(contenuTelecharge, contenuOriginal);
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

test('lister retourne un tableau vide si le dossier candidat n\'existe pas encore (404)', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    'GET /drives/drive-1/root:/42:/children': { erreur: { statusCode: 404, code: 'itemNotFound' } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  assert.deepEqual(await connecteurMocke.lister('42'), []);
});

test('lister traduit une erreur 429 (limite de débit) en message clair', async (t) => {
  const client = creerClientMock({
    [`GET ${CHEMIN_DRIVES}`]: REPONSE_DRIVES_OK,
    'GET /drives/drive-1/root:/42:/children': { erreur: { statusCode: 429 } },
  });
  const connecteurMocke = chargerConnecteurAvecClient(t, client);

  await assert.rejects(() => connecteurMocke.lister('42'), /Limite de débit Microsoft Graph atteinte/);
});
