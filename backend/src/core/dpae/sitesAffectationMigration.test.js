const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

// Placé ici plutôt qu'à côté de la migration : knex charge TOUS les fichiers .js de
// src/db/migrations comme des migrations, un fichier de test y serait pris pour l'une d'elles.
const migration = require('../../db/migrations/069_creation_referentiel_sites_affectation');

const { SITES_AFFECTATION_INITIAUX, requeteInsertionSitesInitiaux } = migration;

// Instance knex RÉELLE mais jamais connectée (même principe que dossierRepository.test.js) : on
// vérifie le SQL généré. L'insertion réelle a en plus été contrôlée sur la base DEV (69 lignes,
// relance sans doublon).
const bd = knex({ client: 'pg' });

test('Migration 069 : liste initiale de 69 sites, noms et initiales uniques sans tenir compte des majuscules', () => {
  assert.equal(SITES_AFFECTATION_INITIAUX.length, 69);
  const noms = new Set(SITES_AFFECTATION_INITIAUX.map(([nom]) => nom.toLowerCase()));
  const initiales = new Set(SITES_AFFECTATION_INITIAUX.map(([, ini]) => ini.toLowerCase()));
  assert.equal(noms.size, 69);
  assert.equal(initiales.size, 69);
});

test('Migration 069 : toutes les initiales initiales respectent le format exigé à la création (majuscules et chiffres, 2 à 5)', () => {
  for (const [nom, initialesSite] of SITES_AFFECTATION_INITIAUX) {
    assert.match(initialesSite, /^[A-Z0-9]{2,5}$/, nom);
  }
});

test('Migration 069 : noms écrits exactement comme fournis (casse et caractères spéciaux conservés)', () => {
  const noms = SITES_AFFECTATION_INITIAUX.map(([nom]) => nom);
  for (const attendu of ['HOTEL DE France', 'YUNA montmartre', 'GRAND CŒUR LATIN', 'RANELAGH / Sœur Assomption', "LIB. GARE DE L'EST", 'X. O.']) {
    assert.ok(noms.includes(attendu), attendu);
  }
});

test("Migration 069 : l'insertion initiale insère les 69 sites pour l'entité fournie, et relancée elle ne crée aucun doublon (ON CONFLICT DO NOTHING)", () => {
  const requete = requeteInsertionSitesInitiaux(bd, 1).toSQL();

  assert.match(requete.sql, /^insert into "sites_affectation"/);
  assert.match(requete.sql, /on conflict do nothing$/);
  // 3 valeurs par ligne (entite_id, nom, initiales).
  assert.equal(requete.bindings.length, 69 * 3);
});
