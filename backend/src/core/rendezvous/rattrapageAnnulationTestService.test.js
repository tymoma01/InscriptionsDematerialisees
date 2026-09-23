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

// Correctif du 2026-09-23 (angle mort constaté en amont sur les dossiers #46/#48/#49/#28/#63/#71/
// #65/#69/#68, audit du motif neutralise_par_forcage) : rendezvousRepository.
// listerDossiersAnnulesNonSynchronises retenait auparavant le PLUS ANCIEN rendez-vous 'annule' d'un
// dossier (GROUP BY + min(id)), sans jamais vérifier qu'un rendez-vous plus récent (replanification
// légitime) n'avait pas entre-temps rendu cette annulation obsolète — reclôturant alors à tort en
// test_non_realise un dossier pourtant valablement reprogrammé. Ces tests couvrent la garde en
// défense côté rendezvousService.resoudreTransitionAnnulationTest (rendezvousRepository.
// existeRendezvousTestPlusRecent) : c'est elle qui décide, pour UN rendezvousId donné (celui que
// listerDossiersAnnulesNonSynchronises aurait sélectionné), si la transition doit encore
// s'appliquer — la sélection elle-même (quel id choisir en base) est couverte séparément en
// génération de SQL, voir rendezvousRepository.test.js.
test("resoudreTransitionAnnulationTest ne renvoie aucune transition quand un rendez-vous 'prevu' plus récent existe sur le même dossier (replanification légitime après l'annulation de A)", async (t) => {
  // A (id 71, annulé) est le rendezvousId reçu ici — même situation que si
  // listerDossiersAnnulesNonSynchronises l'avait encore sélectionné avant que la requête ne soit
  // corrigée ; B (id 72, 'prevu', plus récent) existe déjà sur le dossier.
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({ id: 71, dossier_id: 90, type_rdv: 'test' }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ statut_code: 'test_planifie' }));
  const existePlusRecent = t.mock.method(rendezvousRepository, 'existeRendezvousTestPlusRecent', async () => true);

  const transitions = await rendezvousService.resoudreTransitionAnnulationTest(
    ENTITE_FACTICE,
    { dossierId: 90, rendezvousId: 71 },
    creerBdFactice(),
  );

  assert.deepEqual(transitions, []);
  assert.deepEqual(existePlusRecent.mock.calls[0].arguments.slice(1), [90, 71]);
});

// Même garde, quel que soit le statut du rendez-vous plus récent B — existeRendezvousTestPlusRecent
// ne teste que l'id (récence), jamais le statut de B (voir son commentaire, rendezvousRepository.js) :
// seul le PLUS RÉCENT rendez-vous test du dossier compte, A (plus ancien) n'est jamais retenu, que B
// soit 'remplace' ou 'annule' lui-même.
for (const statutB of ['remplace', 'annule']) {
  test(`resoudreTransitionAnnulationTest ne renvoie aucune transition pour A (ancien, annulé) quand B (plus récent, '${statutB}') existe — seul le plus récent compte`, async (t) => {
    t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({ id: 71, dossier_id: 90, type_rdv: 'test' }));
    t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ statut_code: 'test_planifie' }));
    // existeRendezvousTestPlusRecent ne reçoit jamais le statut de B — sa seule condition est
    // `id > rendezvousId` (voir rendezvousRepository.js) : vrai ici quel que soit statutB, la
    // boucle ci-dessus ne fait que documenter que ce comportement est le même pour les deux valeurs.
    t.mock.method(rendezvousRepository, 'existeRendezvousTestPlusRecent', async () => true);

    const transitions = await rendezvousService.resoudreTransitionAnnulationTest(
      ENTITE_FACTICE,
      { dossierId: 90, rendezvousId: 71 },
      creerBdFactice(),
    );

    assert.deepEqual(transitions, []);
  });
}

test("resoudreTransitionAnnulationTest applique toujours la transition test_non_realise quand A (annulé) est seul sur le dossier — non-régression", async (t) => {
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({ id: 71, dossier_id: 90, type_rdv: 'test' }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ statut_code: 'test_planifie' }));
  t.mock.method(rendezvousRepository, 'existeRendezvousTestPlusRecent', async () => false);
  t.mock.method(rendezvousRepository, 'existeRendezvousTestActif', async () => false);

  const transitions = await rendezvousService.resoudreTransitionAnnulationTest(
    ENTITE_FACTICE,
    { dossierId: 90, rendezvousId: 71 },
    creerBdFactice(),
  );

  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].codeAction, 'test_non_realise');
});

// Correctif complémentaire du 2026-09-23 (contrôle fonctionnel dossier #129 en dev) : "le plus
// récent par id" ne suffit pas — dossier #129 porte un rendez-vous 173 ('prevu', créneau du 24/09)
// d'id INFÉRIEUR aux rendez-vous 176/177 ('annule', créneaux plus anciens des 10/09 et 11/09, mais
// créés après 173). La requête corrigée (listerDossiersAnnulesNonSynchronises) retient 177 comme
// "dernier" rendez-vous test du dossier et déclencherait test_non_realise SANS cette seconde garde
// (existeRendezvousTestPlusRecent(dossier, 177) est FALSE : rien n'a un id > 177) — alors qu'un test
// actif (173) existe bel et bien. Reproduit exactement les id/statuts du dossier #129.
test("resoudreTransitionAnnulationTest ne renvoie aucune transition pour le dossier #129 (rendez-vous 173 'prevu' d'id inférieur au rendez-vous 177 'annule' retenu) — l'ordre des id ne suffit pas", async (t) => {
  t.mock.method(rendezvousRepository, 'trouverRendezvousParId', async () => ({ id: 177, dossier_id: 129, type_rdv: 'test' }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ statut_code: 'test_planifie' }));
  t.mock.method(rendezvousRepository, 'existeRendezvousTestPlusRecent', async () => false);
  const existeActif = t.mock.method(rendezvousRepository, 'existeRendezvousTestActif', async () => true);

  const transitions = await rendezvousService.resoudreTransitionAnnulationTest(
    ENTITE_FACTICE,
    { dossierId: 129, rendezvousId: 177 },
    creerBdFactice(),
  );

  assert.deepEqual(transitions, []);
  assert.deepEqual(existeActif.mock.calls[0].arguments.slice(1), [129]);
});
