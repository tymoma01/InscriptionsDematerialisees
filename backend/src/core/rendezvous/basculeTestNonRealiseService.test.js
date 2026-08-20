const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const journalAudit = require('../audit/journalAudit');
const { executerBasculeTestNonRealise } = require('./basculeTestNonRealiseService');

const ENTITE_FACTICE = { id: 1, code: 'accecit' };
const UTILISATEUR_SYSTEME_FACTICE = { id: 99 };

// bd factice avec un .transaction(fn) qui exécute simplement fn(bd) (pas de vraie isolation, un
// test unitaire n'en a pas besoin) — même patron que rendezvousService.test.js.
function creerBdFactice() {
  const bd = {};
  bd.transaction = async (fn) => fn(bd);
  return bd;
}

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => UTILISATEUR_SYSTEME_FACTICE);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  // Par défaut, ne vérifie rien de plus que "ça réussit" — les tests qui veulent vérifier l'appel
  // précis (statut 'absent', motifCode, ordre vs appliquerTransition) remplacent ce mock localement
  // (voir le test "bascule un rendez-vous..." ci-dessous).
  t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => ({}));
}

test("executerBasculeTestNonRealise n'appelle rien si aucun rendez-vous n'est éligible", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerRendezvousTestNonRealisesAutomatiquement', async () => []);
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({}));

  const resultat = await executerBasculeTestNonRealise(ENTITE_FACTICE);

  assert.equal(appliquerTransition.mock.callCount(), 0);
  assert.deepEqual(resultat, { bascules: 0, ignores: 0, echecs: 0, total: 0 });
});

test('executerBasculeTestNonRealise bascule un rendez-vous encore prevu à la relecture verrouillée, et ferme aussi le rendez-vous (audit 2026-08-20, dossier #84)', async (t) => {
  mockerBase(t);
  const rdv = { id: 10, dossier_id: 42, date_heure: '2026-08-01T09:00:00.000Z' };
  t.mock.method(rendezvousRepository, 'listerRendezvousTestNonRealisesAutomatiquement', async () => [rdv]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({ ...rdv, statut: 'prevu' }));

  // Ordre observé : changerStatutRendezvous doit être appelé AVANT appliquerTransition (voir
  // basculeTestNonRealiseService.js — le garde-fou STATUTS_DOSSIER_RENDEZVOUS_CLOS de
  // changerStatutRendezvous doit encore voir le dossier test_planifie, pas déjà test_non_realise).
  const ordreAppels = [];
  const changerStatutRendezvous = t.mock.method(rendezvousService, 'changerStatutRendezvous', async () => {
    ordreAppels.push('changerStatutRendezvous');
    return {};
  });
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => {
    ordreAppels.push('appliquerTransition');
    return { statutDestinationId: 4 };
  });
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultat = await executerBasculeTestNonRealise(ENTITE_FACTICE);

  assert.equal(changerStatutRendezvous.mock.callCount(), 1);
  const appelRdv = changerStatutRendezvous.mock.calls[0].arguments;
  assert.equal(appelRdv[0], ENTITE_FACTICE);
  assert.equal(appelRdv[1].dossierId, 42);
  assert.equal(appelRdv[1].rendezvousId, 10);
  assert.equal(appelRdv[1].statut, 'absent');
  assert.equal(appelRdv[1].motifCode, 'test_non_realise');

  assert.equal(appliquerTransition.mock.callCount(), 1);
  const appel = appliquerTransition.mock.calls[0].arguments;
  assert.equal(appel[0], ENTITE_FACTICE);
  assert.equal(appel[1].dossierId, 42);
  assert.equal(appel[1].codeAction, 'test_non_realise');
  assert.equal(appel[1].utilisateurId, UTILISATEUR_SYSTEME_FACTICE.id);
  assert.equal(appel[1].roleCode, 'systeme');

  assert.deepEqual(ordreAppels, ['changerStatutRendezvous', 'appliquerTransition']);

  assert.equal(enregistrerAction.mock.callCount(), 1);
  assert.equal(enregistrerAction.mock.calls[0].arguments[1].action, 'dossier_transition_test_non_realise_automatique');
  assert.deepEqual(resultat, { bascules: 1, ignores: 0, echecs: 0, total: 1 });
});

test('executerBasculeTestNonRealise ignore un rendez-vous déjà traité manuellement entre-temps (statut != prevu à la relecture verrouillée)', async (t) => {
  mockerBase(t);
  const rdv = { id: 11, dossier_id: 43, date_heure: '2026-08-01T09:00:00.000Z' };
  t.mock.method(rendezvousRepository, 'listerRendezvousTestNonRealisesAutomatiquement', async () => [rdv]);
  // Un agent a confirmé la présence juste avant l'exécution de la tâche : la relecture verrouillée
  // voit désormais 'confirme', plus 'prevu'.
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async () => ({ ...rdv, statut: 'confirme' }));
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({}));

  const resultat = await executerBasculeTestNonRealise(ENTITE_FACTICE);

  assert.equal(appliquerTransition.mock.callCount(), 0);
  assert.deepEqual(resultat, { bascules: 0, ignores: 1, echecs: 0, total: 1 });
});

test('executerBasculeTestNonRealise continue sur les rendez-vous suivants après un échec isolé', async (t) => {
  mockerBase(t);
  const rdv1 = { id: 12, dossier_id: 44, date_heure: '2026-08-01T09:00:00.000Z' };
  const rdv2 = { id: 13, dossier_id: 45, date_heure: '2026-08-02T09:00:00.000Z' };
  t.mock.method(rendezvousRepository, 'listerRendezvousTestNonRealisesAutomatiquement', async () => [rdv1, rdv2]);
  t.mock.method(rendezvousRepository, 'trouverRendezvousPourBasculeVerrouillee', async (trx, id) => ({
    id,
    dossier_id: id === rdv1.id ? rdv1.dossier_id : rdv2.dossier_id,
    statut: 'prevu',
  }));
  let appel = 0;
  t.mock.method(workflowEngine, 'appliquerTransition', async () => {
    appel += 1;
    if (appel === 1) throw new Error('dossier déjà sorti de test_planifie');
    return { statutDestinationId: 4 };
  });

  const resultat = await executerBasculeTestNonRealise(ENTITE_FACTICE);

  assert.deepEqual(resultat, { bascules: 1, ignores: 0, echecs: 1, total: 2 });
});

test('executerBasculeTestNonRealise échoue explicitement si aucun utilisateur système configuré', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => undefined);

  await assert.rejects(() => executerBasculeTestNonRealise(ENTITE_FACTICE), /Utilisateur système non configuré/);
});
