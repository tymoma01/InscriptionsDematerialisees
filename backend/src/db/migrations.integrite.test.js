const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// knex charge TOUT fichier du dossier des migrations comme une migration : un test ou un utilitaire
// qui s'y trouve empêche le serveur de démarrer (« must have both an up and down function »).
// Les tests de migration vivent à côté du code métier concerné (ex. core/dpae/sitesAffectationMigration.test.js).
const DOSSIER = path.join(__dirname, 'migrations');
const fichiers = fs.readdirSync(DOSSIER);

test('le dossier des migrations ne contient que des fichiers NNN_nom.js', () => {
  const intrus = fichiers.filter((fichier) => !/^\d{3}_[a-z0-9_]+\.js$/.test(fichier) || /\.test\.js$/.test(fichier));
  assert.deepEqual(intrus, [], `Fichier(s) à déplacer hors de src/db/migrations : ${intrus.join(', ')}`);
});

test('chaque fichier du dossier des migrations exporte up et down', () => {
  for (const fichier of fichiers) {
    const migration = require(path.join(DOSSIER, fichier));
    assert.equal(typeof migration.up, 'function', `${fichier} : up manquante`);
    assert.equal(typeof migration.down, 'function', `${fichier} : down manquante`);
  }
});

test('numéros de migration uniques et sans trou d’ordre de nommage', () => {
  const numeros = fichiers.map((fichier) => fichier.slice(0, 3));
  const doublons = numeros.filter((numero, i) => numeros.indexOf(numero) !== i);
  assert.deepEqual(doublons, []);
});
