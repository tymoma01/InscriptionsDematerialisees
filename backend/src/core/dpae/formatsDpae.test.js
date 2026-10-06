const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { formaterHeure, formaterHeuresParMois } = require('./formatsDpae');
const { COORDONNEES_ACCECIT } = require('../../config/coordonneesAccecit');

test('Heure : « 08h00 » au lieu de « 08:00:00 » ; valeur vide conservée ; valeur inattendue rendue telle quelle', () => {
  assert.equal(formaterHeure('08:00:00'), '08h00');
  assert.equal(formaterHeure('8:05'), '08h05');
  assert.equal(formaterHeure('17:30'), '17h30');
  assert.equal(formaterHeure(null), null);
  assert.equal(formaterHeure(''), '');
  assert.equal(formaterHeure('matin'), 'matin');
});

test('Heures par mois : « 120 h », virgule française s’il y a une décimale (« 120,5 h », « 151,67 h »)', () => {
  assert.equal(formaterHeuresParMois('120.00'), '120 h');
  assert.equal(formaterHeuresParMois('120.50'), '120,5 h');
  assert.equal(formaterHeuresParMois('151.67'), '151,67 h');
  assert.equal(formaterHeuresParMois(35), '35 h');
  assert.equal(formaterHeuresParMois('1500.00'), '1500 h');
  assert.equal(formaterHeuresParMois(null), null);
  assert.equal(formaterHeuresParMois('environ 120'), 'environ 120');
});

// Fichiers dupliqués backend/frontend (applications construites séparément) : ce test échoue si
// l'une des deux copies change sans l'autre. Ignoré si le frontend est absent (image du backend).
const FRONTEND = path.join(__dirname, '../../../../frontend/src');

test('Formats : la copie frontend (frontend/src/core/dpae/formatsDpae.js) contient les mêmes fonctions', { skip: !fs.existsSync(FRONTEND) }, () => {
  const corps = (source) => source.slice(source.indexOf('// « 08:00:00 »')).replace(/^export /gm, '').replace(/\nmodule\.exports[\s\S]*$/, '').trim();
  const back = fs.readFileSync(path.join(__dirname, 'formatsDpae.js'), 'utf8');
  const front = fs.readFileSync(path.join(FRONTEND, 'core/dpae/formatsDpae.js'), 'utf8');
  assert.equal(corps(front), corps(back));
});

test('Coordonnées ACCECIT : identiques à la source frontend (core/backOffice/coordonneesAccecit.js)', { skip: !fs.existsSync(FRONTEND) }, () => {
  const front = fs.readFileSync(path.join(FRONTEND, 'core/backOffice/coordonneesAccecit.js'), 'utf8');
  for (const [cle, valeur] of Object.entries(COORDONNEES_ACCECIT)) {
    assert.ok(front.includes(`${cle}: '${valeur}'`), `${cle} diffère entre backend et frontend`);
  }
  assert.deepEqual(Object.keys(COORDONNEES_ACCECIT), ['nom', 'adresse', 'telephone', 'siteWeb']);
});

test('libelleSiteJour : « NOM (INITIALES) » du site du jour, null sans site ou site introuvable', () => {
  const { libelleSiteJour } = require('./formatsDpae');
  const sites = [{ id: 51, nom: 'AIGLON', initiales: 'AIG' }];
  assert.equal(libelleSiteJour({ siteId: 51 }, sites), 'AIGLON (AIG)');
  assert.equal(libelleSiteJour({}, sites), null);
  assert.equal(libelleSiteJour({ siteId: 99 }, sites), null);
  assert.equal(libelleSiteJour({ siteId: 51 }, undefined), null);
});
