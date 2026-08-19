const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

// Recharge sauvegardeService et ses dépendances à l'état initial avant chaque test, et mocke les
// modules collaborateurs — même approche que azureOneDriveConnector.test.js. Aucun pg_dump/appel
// Graph réel dans ces tests : on vérifie uniquement l'orchestration (ordre des appels, gestion des
// erreurs, rétention, nettoyage).
function chargerServiceAvecMocks(t, { creerDump, chiffrerFichier, uploaderSauvegarde, listerSauvegardes, supprimerSauvegarde, notifierEchecSauvegarde } = {}) {
  for (const nomModule of [
    './sauvegardeService',
    './pgDumpService',
    './chiffrementSauvegarde',
    './stockageSauvegardeGraph',
    './notificationEchecSauvegarde',
  ]) {
    delete require.cache[require.resolve(nomModule)];
  }

  const pgDumpService = require('./pgDumpService');
  const chiffrementSauvegarde = require('./chiffrementSauvegarde');
  const stockageSauvegardeGraph = require('./stockageSauvegardeGraph');
  const notificationEchecSauvegarde = require('./notificationEchecSauvegarde');

  t.mock.method(pgDumpService, 'creerDump', creerDump ?? (async (chemin) => fs.writeFile(chemin, 'dump factice')));
  t.mock.method(
    chiffrementSauvegarde,
    'chiffrerFichier',
    chiffrerFichier ?? (async (entree, sortie) => fs.writeFile(sortie, 'contenu chiffré factice')),
  );
  t.mock.method(stockageSauvegardeGraph, 'uploaderSauvegarde', uploaderSauvegarde ?? (async () => {}));
  t.mock.method(stockageSauvegardeGraph, 'listerSauvegardes', listerSauvegardes ?? (async () => []));
  t.mock.method(stockageSauvegardeGraph, 'supprimerSauvegarde', supprimerSauvegarde ?? (async () => {}));
  t.mock.method(notificationEchecSauvegarde, 'notifierEchecSauvegarde', notifierEchecSauvegarde ?? (async () => {}));

  return {
    sauvegardeService: require('./sauvegardeService'),
    pgDumpService,
    chiffrementSauvegarde,
    stockageSauvegardeGraph,
    notificationEchecSauvegarde,
  };
}

test('executerSauvegarde : déroulé nominal (dump -> chiffrement -> upload -> rétention)', async (t) => {
  const { sauvegardeService, stockageSauvegardeGraph } = chargerServiceAvecMocks(t);

  const resultat = await sauvegardeService.executerSauvegarde();

  assert.equal(resultat.succes, true);
  assert.match(resultat.nomFichier, /^backup-\d{4}-\d{2}-\d{2}\.dump\.enc$/);
  assert.equal(resultat.sauvegardesSupprimees, 0);
  assert.equal(stockageSauvegardeGraph.uploaderSauvegarde.mock.calls.length, 1);
  assert.equal(stockageSauvegardeGraph.uploaderSauvegarde.mock.calls[0].arguments[0], resultat.nomFichier);
});

test('executerSauvegarde : purge uniquement les sauvegardes au-delà des 30 plus récentes', async (t) => {
  const sauvegardesExistantes = Array.from({ length: 33 }, (_, i) => ({
    id: `item-${i}`,
    nom: `backup-${i}.dump.enc`,
    dateCreation: new Date(2026, 0, 33 - i), // déjà triées, la plus récente en premier
  }));

  const { sauvegardeService, stockageSauvegardeGraph } = chargerServiceAvecMocks(t, {
    listerSauvegardes: async () => sauvegardesExistantes,
  });

  const resultat = await sauvegardeService.executerSauvegarde();

  assert.equal(resultat.sauvegardesSupprimees, 3);
  assert.equal(stockageSauvegardeGraph.supprimerSauvegarde.mock.calls.length, 3);
  assert.deepEqual(
    stockageSauvegardeGraph.supprimerSauvegarde.mock.calls.map((appel) => appel.arguments[0]),
    ['item-30', 'item-31', 'item-32'],
  );
});

test('executerSauvegarde : sur échec du pg_dump, notifie puis relance l\'erreur (jamais silencieux)', async (t) => {
  const erreurDump = new Error('pg_dump a échoué (code 1)');
  const { sauvegardeService, notificationEchecSauvegarde, stockageSauvegardeGraph } = chargerServiceAvecMocks(t, {
    creerDump: async () => {
      throw erreurDump;
    },
  });

  await assert.rejects(() => sauvegardeService.executerSauvegarde(), erreurDump);

  assert.equal(notificationEchecSauvegarde.notifierEchecSauvegarde.mock.calls.length, 1);
  assert.equal(notificationEchecSauvegarde.notifierEchecSauvegarde.mock.calls[0].arguments[0], erreurDump);
  // L'échec du dump survient avant toute tentative d'upload : aucun appel réseau superflu.
  assert.equal(stockageSauvegardeGraph.uploaderSauvegarde.mock.calls.length, 0);
});

test('executerSauvegarde : nettoie le dossier temporaire local même en cas d\'échec', async (t) => {
  let cheminDumpUtilise;
  const erreurChiffrement = new Error('clé Key Vault introuvable');

  const { sauvegardeService } = chargerServiceAvecMocks(t, {
    creerDump: async (chemin) => {
      cheminDumpUtilise = chemin;
      await fs.writeFile(chemin, 'dump factice');
    },
    chiffrerFichier: async () => {
      throw erreurChiffrement;
    },
  });

  await assert.rejects(() => sauvegardeService.executerSauvegarde(), erreurChiffrement);

  await assert.rejects(() => fs.access(cheminDumpUtilise), /ENOENT/);
});
