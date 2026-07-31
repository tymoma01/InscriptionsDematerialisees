const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const rendezvousService = require('./rendezvousService');

// Le contrôle de date passée intervient avant tout accès DB (voir creerRendezvous) — testable
// sans mock, entité/dossier fictifs compris, puisque l'exécution ne les atteint jamais.
const ENTITE_FACTICE = { id: 1, code: 'accecit' };

// Créneau largement dans le futur, fixe (pas Date.now() + délai) : évite qu'un test devienne
// flaky si l'exécution ralentit autour de la limite "date passée" vérifiée en tout premier dans
// creerRendezvous.
const DATE_HEURE_FUTURE = '2099-01-01T10:00:00.000Z';

function mockerKnexPourCapacite(t, { nombreDejaPresents }) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => nombreDejaPresents);
}

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

test('creerRendezvous accepte un formateur qui a déjà 0 candidat sur ce créneau', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 0 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 1 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 1 });
  assert.equal(creerMock.mock.calls.length, 1);
});

// Le cœur de l'ajustement métier : un formateur peut désormais évaluer jusqu'à 2 candidats sur
// un même créneau, alors qu'un seul rendez-vous existant bloquait tout auparavant.
test('creerRendezvous accepte un formateur qui a déjà 1 candidat sur ce créneau (encore 1 place)', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 1 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 2 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 2 });
  assert.equal(creerMock.mock.calls.length, 1);
});

test('creerRendezvous rejette un formateur qui a déjà 2 candidats sur ce créneau (créneau complet)', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 2 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 3 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: 8,
      }),
    rendezvousService.ErreurCreneauPris,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

// Workflow v4 : replanifier reste possible à tout moment tant que le dossier est test_planifie,
// SAUF dans les 30 minutes précédant le rendez-vous actuel (voir rendezvousService.js, en-tête).
const TRX_FACTICE = { estUnTrx: true };

test("verifierDelaiAvantReplanification ne fait rien si la liste de transitions ne contient pas replanifier_test", async (t) => {
  const trouverDossierMock = t.mock.method(dossierRepository, 'trouverDossierParId', async () => {
    throw new Error('ne devrait jamais être appelé');
  });

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'planifier_test', commentaire: 'Test planifié.' }],
    TRX_FACTICE,
  );

  assert.equal(trouverDossierMock.mock.calls.length, 0);
});

test("verifierDelaiAvantReplanification ne fait rien si le dossier n'est plus test_planifie (replanification depuis test_non_realise/invalide)", async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_non_realise' }));
  const trouverActifMock = t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => {
    throw new Error('ne devrait jamais être appelé');
  });

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );

  assert.equal(trouverActifMock.mock.calls.length, 0);
});

test('verifierDelaiAvantReplanification ne fait rien si le dossier est test_planifie mais sans rendez-vous actif', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );
  // Ne lève pas — rien à protéger.
});

test('verifierDelaiAvantReplanification autorise la replanification si le rendez-vous actuel est encore à plus de 30 minutes', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const dansUneHeure = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: dansUneHeure }));

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );
});

test('verifierDelaiAvantReplanification rejette si le rendez-vous actuel est dans moins de 30 minutes', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const dansQuinzeMinutes = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: dansQuinzeMinutes }));

  await assert.rejects(
    () =>
      rendezvousService.verifierDelaiAvantReplanification(
        ENTITE_FACTICE,
        42,
        [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
        TRX_FACTICE,
      ),
    rendezvousService.ErreurReplanificationTropTardive,
  );
});

test('verifierDelaiAvantReplanification rejette si le rendez-vous actuel est déjà passé', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const ilYADixMinutes = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: ilYADixMinutes }));

  await assert.rejects(
    () =>
      rendezvousService.verifierDelaiAvantReplanification(
        ENTITE_FACTICE,
        42,
        [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
        TRX_FACTICE,
      ),
    rendezvousService.ErreurReplanificationTropTardive,
  );
});
