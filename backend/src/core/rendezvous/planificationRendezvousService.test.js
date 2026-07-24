const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const planificationRendezvousService = require('./planificationRendezvousService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

// Simule bd.transaction(cb) : appelle cb avec un objet "trx" factice et propage la valeur de
// retour/l'erreur — suffisant ici puisque le vrai rollback est un comportement Postgres, pas
// quelque chose à re-tester au niveau unitaire ; ce qui compte pour ce module est que
// creerRendezvous et appliquerTransition reçoivent bien LE MÊME trx (voir assertions plus bas) et
// qu'une erreur dans l'un empêche l'autre d'être considéré comme réussi côté appelant.
const TRX_FACTICE = { estUnTrx: true };
function mockerTransaction(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({
    transaction: async (callback) => callback(TRX_FACTICE),
  }));
}

test('planifierRendezvousAvecTransitions crée le rendez-vous puis applique les transitions dans l\'ordre, avec le même trx', async (t) => {
  mockerTransaction(t);
  const creerRendezvousMock = t.mock.method(rendezvousService, 'creerRendezvous', async () => ({ id: 99 }));
  const appliquerTransitionMock = t.mock.method(
    workflowEngine,
    'appliquerTransition',
    async (entite, { codeAction }) => ({ statutDestinationId: codeAction === 'pieces_completes' ? 3 : 11 }),
  );

  const resultat = await planificationRendezvousService.planifierRendezvousAvecTransitions(ENTITE_ACCECIT, {
    dossierId: 62,
    typeRdv: 'test',
    dateHeure: '2026-07-24T09:30:00.000Z',
    formateurId: 8,
    transitions: [
      { codeAction: 'pieces_completes', commentaire: 'Pièces complètes.' },
      { codeAction: 'planifier_test', commentaire: 'Test planifié.' },
    ],
    utilisateurId: 3,
    roleCode: 'accueil_coordination',
  });

  assert.deepEqual(resultat, { rendezvous: { id: 99 }, statutDestinationId: 11 });

  assert.equal(creerRendezvousMock.mock.calls.length, 1);
  assert.deepEqual(creerRendezvousMock.mock.calls[0].arguments, [
    ENTITE_ACCECIT,
    { dossierId: 62, typeRdv: 'test', dateHeure: '2026-07-24T09:30:00.000Z', formateurId: 8 },
    TRX_FACTICE,
  ]);

  assert.equal(appliquerTransitionMock.mock.calls.length, 2);
  assert.equal(appliquerTransitionMock.mock.calls[0].arguments[1].codeAction, 'pieces_completes');
  assert.equal(appliquerTransitionMock.mock.calls[0].arguments[2], TRX_FACTICE);
  assert.equal(appliquerTransitionMock.mock.calls[1].arguments[1].codeAction, 'planifier_test');
  assert.equal(appliquerTransitionMock.mock.calls[1].arguments[2], TRX_FACTICE);
});

test("planifierRendezvousAvecTransitions rejette sans qu'aucun rendez-vous ne soit considéré créé si une transition échoue (transaction unique)", async (t) => {
  mockerTransaction(t);
  t.mock.method(rendezvousService, 'creerRendezvous', async () => ({ id: 100 }));
  t.mock.method(workflowEngine, 'appliquerTransition', async () => {
    throw new Error('Action "planifier_test" non autorisée depuis le statut courant du dossier "62".');
  });

  await assert.rejects(
    () => planificationRendezvousService.planifierRendezvousAvecTransitions(ENTITE_ACCECIT, {
      dossierId: 62,
      typeRdv: 'test',
      dateHeure: '2026-07-24T09:30:00.000Z',
      formateurId: 8,
      transitions: [{ codeAction: 'planifier_test', commentaire: 'Test planifié.' }],
      utilisateurId: 3,
      roleCode: 'accueil_coordination',
    }),
    /non autorisée depuis le statut courant/,
  );
  // La propagation de l'erreur hors de bd.transaction(...) est ce qui déclenche le ROLLBACK réel
  // chez un vrai knex/pg (non simulé ici) : voir planificationRendezvousService.js, qui ne fait
  // rien d'autre que relayer l'erreur du callback.
});

test('planifierRendezvousAvecTransitions accepte une liste de transitions vide (aucune transition à appliquer)', async (t) => {
  mockerTransaction(t);
  t.mock.method(rendezvousService, 'creerRendezvous', async () => ({ id: 101 }));
  const appliquerTransitionMock = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({}));

  const resultat = await planificationRendezvousService.planifierRendezvousAvecTransitions(ENTITE_ACCECIT, {
    dossierId: 62,
    typeRdv: 'test',
    dateHeure: '2026-07-24T09:30:00.000Z',
    formateurId: 8,
    transitions: [],
    utilisateurId: 3,
    roleCode: 'accueil_coordination',
  });

  assert.deepEqual(resultat, { rendezvous: { id: 101 } });
  assert.equal(appliquerTransitionMock.mock.calls.length, 0);
});
