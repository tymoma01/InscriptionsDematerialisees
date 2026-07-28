const { test } = require('node:test');
const assert = require('node:assert/strict');
const rendezvousService = require('./rendezvousService');

// Le contrôle de date passée intervient avant tout accès DB (voir creerRendezvous) — testable
// sans mock, entité/dossier fictifs compris, puisque l'exécution ne les atteint jamais.
const ENTITE_FACTICE = { id: 1, code: 'accecit' };

test('creerRendezvous rejette une date/heure strictement antérieure à maintenant', async () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await assert.rejects(
    () => rendezvousService.creerRendezvous(ENTITE_FACTICE, { dossierId: 1, typeRdv: 'test', dateHeure: hier, formateurId: null }),
    rendezvousService.ErreurDatePassee,
  );
});

test('creerRendezvous rejette une date/heure passée même de quelques secondes seulement', async () => {
  const ilYA10Secondes = new Date(Date.now() - 10 * 1000).toISOString();
  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 1,
        typeRdv: 'test',
        dateHeure: ilYA10Secondes,
        formateurId: null,
      }),
    rendezvousService.ErreurDatePassee,
  );
});
