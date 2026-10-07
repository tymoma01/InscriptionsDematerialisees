const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const notesDemandeDpaeService = require('./notesDemandeDpaeService');
const { ErreurDemandeIntrouvable, ErreurModificationInterdite } = require('./demandeDpaeService');

// Notes d'une demande DPAE : jamais lues ni écrites sans confirmer que la demande
// appartient à l'entité de la requête.
const ENTITE_ACCECIT = { id: 1, code: 'accecit' };
const ENTITE_AUTRE = { id: 2, code: 'autre_entite' };
const DEMANDES_EN_BASE = [
  { id: 7, entite_id: 1, statut: 'envoyee', demandeur_id: 16 },
  { id: 8, entite_id: 2, statut: 'envoyee', demandeur_id: 16 },
  { id: 9, entite_id: 1, statut: 'a_valider_planning', demandeur_id: 16 },
  { id: 10, entite_id: 1, statut: 'renvoyee_inspecteur', demandeur_id: 16 },
];
const PLANNING = { roleCode: 'planning', utilisateurId: 5 };
const RH = { roleCode: 'rh', utilisateurId: 6 };

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
  const resultat = await notesDemandeDpaeService.ajouterNote(ENTITE_ACCECIT, { demandeId: 7, contenu: 'Relancé le client', auteurId: 42, roleCode: 'planning' });
  assert.deepEqual(resultat, { noteId: 55 });
  assert.deepEqual(ajouterMock.mock.calls[0].arguments[1], { demandeId: 7, auteurId: 42, contenu: 'Relancé le client' });
});

test('listerNotes : notes de la demande, requête scopée sur l’entité', async (t) => {
  const { listerMock } = mockerBase(t);
  const notes = await notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, 7, PLANNING);
  assert.deepEqual(notes, [{ id: 55, contenu: 'Relancé le client' }]);
  assert.deepEqual(listerMock.mock.calls[0].arguments.slice(1), [1, 7]);
});

test('Demande d’une autre entité : introuvable, aucune note lue ni écrite', async (t) => {
  const { ajouterMock, listerMock } = mockerBase(t);
  await assert.rejects(() => notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, 8, PLANNING), ErreurDemandeIntrouvable);
  await assert.rejects(
    () => notesDemandeDpaeService.ajouterNote(ENTITE_ACCECIT, { demandeId: 8, contenu: 'x', auteurId: 42, roleCode: 'planning' }),
    ErreurDemandeIntrouvable,
  );
  await assert.rejects(() => notesDemandeDpaeService.listerNotes(ENTITE_AUTRE, 7, PLANNING), ErreurDemandeIntrouvable);
  assert.equal(ajouterMock.mock.calls.length, 0);
  assert.equal(listerMock.mock.calls.length, 0);
});

test('RH aveugle aux demandes encore chez le Planning : notes illisibles et non ajoutables (403), même règle que la fiche ; lisibles une fois transmises', async (t) => {
  const { ajouterMock, listerMock } = mockerBase(t);
  for (const demandeId of [9, 10]) {
    await assert.rejects(() => notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, demandeId, RH), ErreurModificationInterdite);
    await assert.rejects(
      () => notesDemandeDpaeService.ajouterNote(ENTITE_ACCECIT, { demandeId, contenu: 'x', auteurId: 6, roleCode: 'rh' }),
      ErreurModificationInterdite,
    );
  }
  assert.equal(ajouterMock.mock.calls.length, 0);
  assert.equal(listerMock.mock.calls.length, 0);

  await notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, 7, RH);
  await notesDemandeDpaeService.listerNotes(ENTITE_ACCECIT, 9, PLANNING);
  assert.equal(listerMock.mock.calls.length, 2);
});
