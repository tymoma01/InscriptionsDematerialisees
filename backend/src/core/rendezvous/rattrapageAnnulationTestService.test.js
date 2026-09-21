const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const journalAudit = require('../audit/journalAudit');
const { executerRattrapageAnnulationTest } = require('./rattrapageAnnulationTestService');

const ENTITE_FACTICE = { id: 1, code: 'accecit' };
const UTILISATEUR_SYSTEME_FACTICE = { id: 99 };

// bd factice avec un .transaction(fn) qui exécute simplement fn(bd) — même patron que
// basculeTestNonRealiseService.test.js.
function creerBdFactice() {
  const bd = {};
  bd.transaction = async (fn) => fn(bd);
  return bd;
}

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => UTILISATEUR_SYSTEME_FACTICE);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
}

test("executerRattrapageAnnulationTest n'appelle rien si aucun dossier candidat", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerDossiersAnnulesNonSynchronises', async () => []);
  const resoudreTransition = t.mock.method(rendezvousService, 'resoudreTransitionAnnulationTest', async () => []);
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({}));

  const resultat = await executerRattrapageAnnulationTest(ENTITE_FACTICE);

  assert.equal(resoudreTransition.mock.callCount(), 0);
  assert.equal(appliquerTransition.mock.callCount(), 0);
  assert.deepEqual(resultat, { corriges: 0, ignores: 0, echecs: 0, total: 0 });
});

test('executerRattrapageAnnulationTest bascule un dossier candidat quand resoudreTransitionAnnulationTest renvoie une transition', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerDossiersAnnulesNonSynchronises', async () => [{ dossier_id: 29, rendezvous_id: 13 }]);
  const resoudreTransition = t.mock.method(rendezvousService, 'resoudreTransitionAnnulationTest', async () => [
    { codeAction: 'test_non_realise', commentaire: 'Test non réalisé (rendez-vous annulé).' },
  ]);
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({ statutDestinationId: 4 }));
  const enregistrerAction = t.mock.method(journalAudit, 'enregistrerAction', async () => {});

  const resultat = await executerRattrapageAnnulationTest(ENTITE_FACTICE);

  assert.equal(resoudreTransition.mock.callCount(), 1);
  assert.equal(resoudreTransition.mock.calls[0].arguments[0], ENTITE_FACTICE);
  assert.deepEqual(resoudreTransition.mock.calls[0].arguments[1], { dossierId: 29, rendezvousId: 13 });

  assert.equal(appliquerTransition.mock.callCount(), 1);
  const appel = appliquerTransition.mock.calls[0].arguments;
  assert.equal(appel[1].dossierId, 29);
  assert.equal(appel[1].codeAction, 'test_non_realise');
  assert.equal(appel[1].utilisateurId, UTILISATEUR_SYSTEME_FACTICE.id);
  // Acteur SYSTEME : ce filet de sécurité agit sans agent connecté, même patron que
  // basculeTestNonRealiseService.js.
  assert.equal(appel[1].roleCode, 'systeme');

  assert.equal(enregistrerAction.mock.callCount(), 1);
  assert.equal(enregistrerAction.mock.calls[0].arguments[1].action, 'dossier_transition_test_non_realise_annulation_rattrapage');
  assert.deepEqual(resultat, { corriges: 1, ignores: 0, echecs: 0, total: 1 });
});

test("executerRattrapageAnnulationTest ignore un dossier dont la transition ne s'applique plus (déjà refermé autrement entre-temps) — idempotence", async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerDossiersAnnulesNonSynchronises', async () => [{ dossier_id: 30, rendezvous_id: 14 }]);
  t.mock.method(rendezvousService, 'resoudreTransitionAnnulationTest', async () => []);
  const appliquerTransition = t.mock.method(workflowEngine, 'appliquerTransition', async () => ({}));

  const resultat = await executerRattrapageAnnulationTest(ENTITE_FACTICE);

  assert.equal(appliquerTransition.mock.callCount(), 0);
  assert.deepEqual(resultat, { corriges: 0, ignores: 1, echecs: 0, total: 1 });
});

test('executerRattrapageAnnulationTest continue sur les dossiers suivants après un échec isolé', async (t) => {
  mockerBase(t);
  t.mock.method(rendezvousRepository, 'listerDossiersAnnulesNonSynchronises', async () => [
    { dossier_id: 41, rendezvous_id: 26 },
    { dossier_id: 42, rendezvous_id: 27 },
  ]);
  t.mock.method(rendezvousService, 'resoudreTransitionAnnulationTest', async () => [
    { codeAction: 'test_non_realise', commentaire: 'Test non réalisé (rendez-vous annulé).' },
  ]);
  let appel = 0;
  t.mock.method(workflowEngine, 'appliquerTransition', async () => {
    appel += 1;
    if (appel === 1) throw new Error('dossier déjà sorti de test_planifie');
    return { statutDestinationId: 4 };
  });

  const resultat = await executerRattrapageAnnulationTest(ENTITE_FACTICE);

  assert.deepEqual(resultat, { corriges: 1, ignores: 0, echecs: 1, total: 2 });
});

test('executerRattrapageAnnulationTest échoue explicitement si aucun utilisateur système configuré', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverUtilisateurSysteme', async () => undefined);

  await assert.rejects(() => executerRattrapageAnnulationTest(ENTITE_FACTICE), /Utilisateur système non configuré/);
});
