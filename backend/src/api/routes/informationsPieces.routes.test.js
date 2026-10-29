const test = require('node:test');
const assert = require('node:assert/strict');

const { pieceIdentiteBodySchema, ribBodySchema } = require('./informationsPieces.routes');
const { ibanValide } = require('../../core/dossier/informationsPiecesService');
const { aPermission } = require('../../core/auth/permissions');

// Aucune infrastructure de test HTTP dans ce projet (voir dossiers.routes.test.js) : on teste les
// VRAIS schémas montés sur les routes, et la matrice des permissions qu'elles vérifient.

// IBAN d'exemple de la norme ISO 13616, valide.
const IBAN = 'FR7630006000011234567890189';

test('ibanValide : clé modulo 97', () => {
  assert.equal(ibanValide(IBAN), true);
  assert.equal(ibanValide('FR7630006000011234567890188'), false);
  assert.equal(ibanValide('FR76'), false);
});

test('PUT rib : IBAN et BIC compactés en majuscules', () => {
  assert.deepEqual(ribBodySchema.parse({ iban: 'fr76 3000 6000 0112 3456 7890 189', bic: 'agri frpp 882' }), {
    iban: IBAN,
    bic: 'AGRIFRPP882',
  });
  assert.equal(ribBodySchema.safeParse({ iban: IBAN, bic: 'AGRIFRPP' }).success, true);
});

test('PUT rib : IBAN à la clé fausse ou BIC mal formé -> refus', () => {
  assert.equal(ribBodySchema.safeParse({ iban: 'FR7630006000011234567890188', bic: 'AGRIFRPP' }).success, false);
  for (const bic of ['AGRIFRP', 'AGRIFRPP88', '1GRIFRPP']) {
    assert.equal(ribBodySchema.safeParse({ iban: IBAN, bic }).success, false, bic);
  }
});

test('PUT piece-identite : numéro compacté, délivrance facultative', () => {
  assert.deepEqual(pieceIdentiteBodySchema.parse({ type: 'carte_identite', numero: 'x4rtbpfw4 ', expireLe: '2031-06-30' }), {
    type: 'carte_identite',
    numero: 'X4RTBPFW4',
    delivreeLe: null,
    expireLe: '2031-06-30',
  });
});

test('PUT piece-identite : type inconnu, numéro invalide, expiration avant délivrance -> refus', () => {
  const valide = { type: 'passeport', numero: '12AB34567', delivreeLe: '2021-06-30', expireLe: '2031-06-29' };
  assert.equal(pieceIdentiteBodySchema.safeParse(valide).success, true);
  assert.equal(pieceIdentiteBodySchema.safeParse({ ...valide, type: 'permis' }).success, false);
  assert.equal(pieceIdentiteBodySchema.safeParse({ ...valide, numero: 'AB-12' }).success, false);
  assert.equal(pieceIdentiteBodySchema.safeParse({ ...valide, expireLe: '2020-01-01' }).success, false);
  assert.equal(pieceIdentiteBodySchema.safeParse({ ...valide, expireLe: '30/06/2031' }).success, false);
});

test('GET : IBAN en clair réservé à Accueil/Coordination, Planning, Admin et RH', () => {
  for (const role of ['accueil_coordination', 'planning', 'admin', 'rh']) {
    assert.equal(aPermission(role, 'lectureInformationsPieces'), true, role);
  }
  for (const role of ['formateur', 'inspecteur', 'inspecteur_hotellerie']) {
    assert.equal(aPermission(role, 'lectureInformationsPieces'), false, role);
  }
});
