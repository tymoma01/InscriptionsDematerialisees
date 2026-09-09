const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const workflowEngine = require('./workflowEngine');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

const DOSSIER_TEST_PLANIFIE = { id: 127, statut_id: 11, statut_code: 'test_planifie', statut_libelle: 'Test planifié' };
const STATUT_TEST_NON_REALISE = { id: 15, code: 'test_non_realise', libelle: 'Test non réalisé', neutralise_rendezvous_actifs: false };

const TRX_FACTICE = { estUnTrx: true };

// Même patron que evaluationEngine.test.js (mockerKnex) : bd.transaction appelle directement le
// callback avec un trx factice, suffisant au niveau unitaire — dossierRepository/rendezvousRepository
// sont mockées directement, jamais de vraie requête SQL ici.
function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback(TRX_FACTICE) }));
}

function mockerDependancesBase(t, overrides = {}) {
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', overrides.trouverDossierAvecStatutParId ?? (async () => DOSSIER_TEST_PLANIFIE));
  t.mock.method(dossierRepository, 'trouverStatutParCode', overrides.trouverStatutParCode ?? (async () => STATUT_TEST_NON_REALISE));
  const enregistrerChangementStatutMock = t.mock.method(dossierRepository, 'enregistrerChangementStatut', async () => {});
  const neutraliserMock = t.mock.method(
    rendezvousRepository,
    'neutraliserRendezvousActifsDossier',
    overrides.neutraliserRendezvousActifsDossier ?? (async () => []),
  );
  return { enregistrerChangementStatutMock, neutraliserMock };
}

// Régression dossier #127 (audit 2026-09-09) : un changement de statut forcé vers un statut dont
// neutralise_rendezvous_actifs=false (test_non_realise pour ACCECIT) laissait jusqu'ici le
// rendez-vous actif intact ("prevu"), désynchronisé du nouveau statut du dossier — voir le
// commentaire d'en-tête de forcerStatut, workflowEngine.js.
test('forcerStatut neutralise TOUJOURS le(s) rendez-vous actif(s), même quand neutralise_rendezvous_actifs=false sur le statut cible', async (t) => {
  mockerKnex(t);
  const { neutraliserMock } = mockerDependancesBase(t, {
    neutraliserRendezvousActifsDossier: async () => [{ id: 160 }],
  });

  const resultat = await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'test_non_realise',
    commentaire: 'Essaye forcing changement de statut dossier',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.equal(neutraliserMock.mock.calls.length, 1);
  const appel = neutraliserMock.mock.calls[0].arguments[1];
  assert.equal(appel.dossierId, 127);
  assert.equal(appel.statutRemplace, 'remplace');
  assert.deepEqual(resultat.rendezvousNeutralises, [160]);
  assert.equal(resultat.statutApresCode, 'test_non_realise');
});

test("forcerStatut renvoie rendezvousNeutralises vide si le dossier n'a aucun rendez-vous actif", async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, { neutraliserRendezvousActifsDossier: async () => [] });

  const resultat = await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'test_non_realise',
    commentaire: 'Correction manuelle.',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.deepEqual(resultat.rendezvousNeutralises, []);
});

test('forcerStatut neutralise aussi vers un statut où neutralise_rendezvous_actifs=true (comportement inchangé, toujours vrai désormais)', async (t) => {
  mockerKnex(t);
  const { neutraliserMock } = mockerDependancesBase(t, {
    trouverStatutParCode: async () => ({ id: 17, code: 'invalide', libelle: 'Invalidé', neutralise_rendezvous_actifs: true }),
    neutraliserRendezvousActifsDossier: async () => [{ id: 200 }],
  });

  await workflowEngine.forcerStatut(ENTITE_ACCECIT, {
    dossierId: 127,
    statutCode: 'invalide',
    commentaire: 'Décision admin.',
    utilisateurId: 9,
    roleCode: 'admin',
  });

  assert.equal(neutraliserMock.mock.calls.length, 1);
});

test('forcerStatut rejette un rôle autre qu’Admin', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_non_realise',
        commentaire: 'Test.',
        utilisateurId: 5,
        roleCode: 'accueil_coordination',
      }),
    /Seul le rôle Admin peut forcer/,
  );
});

test('forcerStatut rejette un commentaire vide', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t);

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_non_realise',
        commentaire: '   ',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /commentaire est obligatoire/,
  );
});

test('forcerStatut rejette un saut vers le statut déjà courant du dossier', async (t) => {
  mockerKnex(t);
  mockerDependancesBase(t, {
    trouverStatutParCode: async () => ({ id: 11, code: 'test_planifie', libelle: 'Test planifié', neutralise_rendezvous_actifs: false }),
  });

  await assert.rejects(
    () =>
      workflowEngine.forcerStatut(ENTITE_ACCECIT, {
        dossierId: 127,
        statutCode: 'test_planifie',
        commentaire: 'Test.',
        utilisateurId: 9,
        roleCode: 'admin',
      }),
    /est déjà au statut/,
  );
});
