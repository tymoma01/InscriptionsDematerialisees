const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const { PERMISSIONS } = require('../auth/permissions');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const statutsDpae = require('./statutsDpae');

// Classement sans suite : statut final, droit par demande, trace d'audit. Base factice : les écritures
// ne sont gardées que si la transaction réussit, comme PostgreSQL.
const ENTITE = { id: 1, code: 'accecit' };
const AUTEUR_ID = 16;
const VERSION = 2;

const demandeEnBase = (statut) => ({ id: 7, entite_id: 1, demandeur_id: AUTEUR_ID, statut, version: VERSION, salarie_nom: 'Martin', salarie_prenom: 'Sophie' });

function mockerBase(t, statut) {
  const etat = { ecritures: [] };
  t.mock.method(db, 'obtenirKnex', async () => ({
    transaction: async (callback) => {
      const trx = { ecritures: [] };
      const resultat = await callback(trx);
      etat.ecritures.push(...trx.ecritures);
      return resultat;
    },
  }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase(statut));
  const classerMock = t.mock.method(demandeDpaeRepository, 'classerSansSuite', async (trx, id, parametres) => {
    trx.ecritures.push(['classement', id, parametres]);
    return 1;
  });
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  t.mock.method(notificationService, 'creerNotifications', async () => {});
  return { etat, classerMock, auditMock };
}

const classer = (roleCode, utilisateurId) =>
  demandeDpaeService.classerSansSuite(ENTITE, 7, utilisateurId, { version: VERSION, adresseIp: '10.0.0.1', roleCode });

test('statut final : la réactivation est la SEULE transition sortante de « Classée sans suite », la demande n’est plus modifiable', () => {
  assert.ok(statutsDpae.CODES_STATUTS_DPAE.includes('classee_sans_suite'));
  assert.deepEqual([...new Set(statutsDpae.TRANSITIONS.filter(({ de }) => de === 'classee_sans_suite').map(({ action }) => action))], ['reactiver']);
  assert.equal(statutsDpae.STATUTS_A_DECIDER.includes('classee_sans_suite'), false);
  assert.equal(statutsDpae.STATUTS_A_TRAITER_RH.includes('classee_sans_suite'), false);
});

test('classement possible depuis les quatre statuts non traités, jamais depuis un statut final', () => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_CLASSER_SANS_SUITE, statut).vers, 'classee_sans_suite', statut);
  }
  for (const statut of ['validee', 'rejetee', 'classee_sans_suite']) {
    assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_CLASSER_SANS_SUITE, statut), undefined, statut);
  }
});

test('permissions : Inspecteur Hôtellerie, Planning et Admin ; toutes les demandes pour Planning et Admin seulement', () => {
  assert.deepEqual([...PERMISSIONS.dpaeClassementSansSuite].sort(), ['admin', 'inspecteur_hotellerie', 'planning']);
  assert.deepEqual([...PERMISSIONS.dpaeClassementSansSuiteToutes].sort(), ['admin', 'planning']);
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_CLASSER_SANS_SUITE), 'dpaeClassementSansSuite');
});

test('peutClasserSansSuite : l’Inspecteur Hôtellerie seulement sur SES demandes ; Planning et Admin sur toutes ; RH et autres jamais', () => {
  const { peutClasserSansSuite } = demandeDpaeService;
  const demande = { demandeur_id: 5 };
  assert.equal(peutClasserSansSuite({ roleCode: 'inspecteur_hotellerie', utilisateurId: 5, demande }), true);
  assert.equal(peutClasserSansSuite({ roleCode: 'inspecteur_hotellerie', utilisateurId: 6, demande }), false);
  for (const roleCode of ['planning', 'admin']) assert.equal(peutClasserSansSuite({ roleCode, utilisateurId: 99, demande }), true, roleCode);
  for (const roleCode of ['rh', 'accueil_coordination', 'formateur', 'inspecteur']) {
    assert.equal(peutClasserSansSuite({ roleCode, utilisateurId: 5, demande }), false, roleCode);
  }
});

test('Inspecteur Hôtellerie : classe sa propre demande ; 403 explicite sur celle d’un autre, rien d’écrit', async (t) => {
  const { etat, classerMock } = mockerBase(t, 'a_valider_planning');
  await classer('inspecteur_hotellerie', AUTEUR_ID);
  assert.equal(classerMock.mock.calls.length, 1);

  const autre = mockerBase(t, 'a_valider_planning');
  await assert.rejects(
    () => classer('inspecteur_hotellerie', 77),
    (erreur) =>
      erreur instanceof demandeDpaeService.ErreurClassementInterdit &&
      erreur instanceof demandeDpaeService.ErreurModificationInterdite &&
      /que vos propres demandes/.test(erreur.message),
  );
  assert.equal(autre.classerMock.mock.calls.length, 0);
  assert.deepEqual(autre.etat.ecritures, []);
  assert.equal(etat.ecritures.length, 2);
});

test('Planning et Admin : classent toute demande non traitée, statut et version écrits par compare-and-set', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    for (const roleCode of ['planning', 'admin']) {
      const { classerMock } = mockerBase(t, statut);
      await classer(roleCode, 99);
      assert.deepEqual(classerMock.mock.calls[0].arguments.slice(1), [7, { statutDepart: statut, version: VERSION, statut: 'classee_sans_suite', classeeParRole: roleCode }], `${roleCode} ${statut}`);
    }
  }
});

test('RH et autres rôles : refus par le service (la route répond déjà 403 par la garde de rôle)', async (t) => {
  for (const roleCode of ['rh', 'accueil_coordination', 'formateur', 'inspecteur']) {
    const { classerMock } = mockerBase(t, 'envoyee');
    await assert.rejects(() => classer(roleCode, 3), demandeDpaeService.ErreurModificationInterdite, roleCode);
    assert.equal(classerMock.mock.calls.length, 0);
  }
});

test('classement refusé depuis un statut final ; toute action refusée sur une demande classée', async (t) => {
  for (const statut of ['validee', 'rejetee', 'classee_sans_suite']) {
    const { etat } = mockerBase(t, statut);
    await assert.rejects(() => classer('admin', 1), demandeDpaeService.ErreurDemandeDejaTraitee, statut);
    assert.deepEqual(etat.ecritures, []);
  }
  const { etat } = mockerBase(t, 'classee_sans_suite');
  const options = { version: VERSION, roleCode: 'admin', adresseIp: 'x' };
  for (const appel of [
    () => demandeDpaeService.valider(ENTITE, 7, 1, options),
    () => demandeDpaeService.rejeter(ENTITE, 7, 1, options),
    () => demandeDpaeService.mettreEnAttente(ENTITE, 7, 1, options),
    () => demandeDpaeService.transmettreALaRh(ENTITE, 7, 1, options),
    () => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 1, options),
    () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: { sitesAffectationIds: [] }, utilisateurId: 1, ...options }),
  ]) {
    await assert.rejects(appel, demandeDpaeService.ErreurDemandeDejaTraitee);
  }
  assert.deepEqual(etat.ecritures, []);
});

test('classement : entrée journal_audit « demande_dpae_classement_sans_suite » (auteur, IP) dans la même transaction', async (t) => {
  const { etat, auditMock } = mockerBase(t, 'envoyee');
  await classer('planning', 8);
  const entree = auditMock.mock.calls[0].arguments[1];
  assert.deepEqual(
    { action: entree.action, tableCible: entree.tableCible, cibleId: entree.cibleId, utilisateurId: entree.utilisateurId, adresseIp: entree.adresseIp },
    { action: 'demande_dpae_classement_sans_suite', tableCible: 'demandes_dpae', cibleId: 7, utilisateurId: 8, adresseIp: '10.0.0.1' },
  );
  assert.deepEqual(etat.ecritures.map(([type]) => type), ['classement', 'audit']);
});

test('classement : échec de l’audit -> le statut n’est pas modifié non plus', async (t) => {
  const { etat, auditMock } = mockerBase(t, 'envoyee');
  auditMock.mock.mockImplementation(async () => {
    throw new Error('journal_audit indisponible');
  });
  await assert.rejects(() => classer('planning', 8), /journal_audit indisponible/);
  assert.deepEqual(etat.ecritures, []);
});

test('la classée sans suite est visible de tous les rôles de consultation (statut final)', () => {
  for (const roleCode of ['rh', 'planning', 'admin', 'inspecteur_hotellerie']) {
    assert.equal(demandeDpaeService.peutVoirStatut(roleCode, 'classee_sans_suite'), true, roleCode);
  }
});
