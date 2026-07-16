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
