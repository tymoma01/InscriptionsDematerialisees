const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const notesDemandeDpaeService = require('./notesDemandeDpaeService');
const { ErreurDemandeIntrouvable } = require('./demandeDpaeService');

// Notes d'une demande DPAE (2026-09-30) : jamais lues ni écrites sans confirmer que la demande
// appartient à l'entité de la requête.
const ENTITE_ACCECIT = { id: 1, code: 'accecit' };
const ENTITE_ADAPTEL = { id: 2, code: 'adaptel' };
const DEMANDES_EN_BASE = [
  { id: 7, entite_id: 1 },
  { id: 8, entite_id: 2 },
];

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async (_bd, entiteId, id) =>
    DEMANDES_EN_BASE.find((d) => d.entite_id === entiteId && d.id === id),
  );
  return {
    ajouterMock: t.mock.method(notesDemandeDpaeRepository, 'ajouterNote', async () => 55),
    listerMock: t.mock.method(notesDemandeDpaeRepository, 'listerNotesParDemande', async () => [{ id: 55, contenu: 'Relancé le client' }]),
  };
}

test('ajouterNote : note enregistrée pour la demande de l’entité, auteur transmis tel quel', async (t) => {
  const { ajouterMock } = mockerBase(t);
  const resultat = await notesDemandeDpaeService.ajouterNote(ENTITE_ACCECIT, { demandeId: 7, contenu: 'Relancé le client', auteurId: 42 });
  assert.deepEqual(resultat, { noteId: 55 });
  assert.deepEqual(ajouterMock.mock.calls[0].arguments[1], { demandeId: 7, auteurId: 42, contenu: 'Relancé le client' });
});

test('listerNotes : notes de la demande, requête scopée sur l’entité', async (t) => {
  const { listerMock } = mockerBase(t);
  const notes = await notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, 7);
  assert.deepEqual(notes, [{ id: 55, contenu: 'Relancé le client' }]);
  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [1, 7]);
});

test('Demande d’une autre entité : introuvable, aucune note lue ni écrite', async (t) => {
  const { ajouterMock, listerMock } = mockerBase(t);
  await assert.rejects(() => notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, 8), ErreurDemandeIntrouvable);
  await assert.rejects(
    () => notesDemandeDpaeService.ajouterNote(ENTITE_ACCECIT, { demandeId: 8, contenu: 'x', auteurId: 42 }),
    ErreurDemandeIntrouvable,
  );
  await assert.rejects(() => notesDemandeDpaeService.listerNotes(ENTITE_ADAPTEL, 7), ErreurDemandeIntrouvable);
  assert.equal(ajouterMock.mock.calls.length, 0);
  assert.equal(listerMock.mock.calls.length, 0);
});
