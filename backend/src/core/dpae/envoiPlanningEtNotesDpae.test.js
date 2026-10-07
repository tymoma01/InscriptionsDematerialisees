const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const { PERMISSIONS } = require('../auth/permissions');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const notesDemandeDpaeService = require('./notesDemandeDpaeService');

// « Envoyer au Planning » (action explicite, la sauvegarde d'une modification ne change plus le statut)
// et ajout de notes sur tout statut.
const ENTITE = { id: 1, code: 'accecit' };
const AUTEUR_ID = 16;
const VERSION = 2;
const PLANNING_IDS = [8, 9];

const demandeEnBase = (statut) => ({ id: 7, entite_id: 1, demandeur_id: AUTEUR_ID, statut, version: VERSION, date_envoi_rh: new Date('2026-10-01T10:00:00Z'), salarie_nom: 'Martin', salarie_prenom: 'Sophie' });

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
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async () => PLANNING_IDS);
  const envoyerMock = t.mock.method(demandeDpaeRepository, 'envoyerAuPlanning', async (trx, id, parametres) => {
    trx.ecritures.push(['envoi', id, parametres]);
    return 1;
  });
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async (trx, notifications) => {
    trx.ecritures.push(['notifications', notifications]);
  });
  return { etat, envoyerMock, auditMock, notificationsMock };
}

const envoyer = (roleCode, utilisateurId) =>
  demandeDpaeService.envoyerAuPlanning(ENTITE, 7, utilisateurId, { version: VERSION, adresseIp: '10.0.0.1', roleCode });

test('permissions : envoi au Planning pour l’Inspecteur Hôtellerie et l’Admin ; toutes les demandes pour l’Admin seulement', () => {
  assert.deepEqual([...PERMISSIONS.dpaeEnvoiPlanning].sort(), ['admin', 'inspecteur_hotellerie']);
  assert.deepEqual([...PERMISSIONS.dpaeEnvoiPlanningToutes], ['admin']);
});

test('envoi au Planning : l’auteur Inspecteur Hôtellerie et l’Admin, « Renvoyée » -> « À valider par le Planning », Planning notifié, audit tracé', async (t) => {
  for (const [roleCode, utilisateurId] of [['inspecteur_hotellerie', AUTEUR_ID], ['admin', 1]]) {
    const { etat, envoyerMock, auditMock, notificationsMock } = mockerBase(t, 'renvoyee_inspecteur');
    await envoyer(roleCode, utilisateurId);

    assert.deepEqual(envoyerMock.mock.calls[0].arguments.slice(1), [7, { statutDepart: 'renvoyee_inspecteur', version: VERSION, statut: 'a_valider_planning' }], roleCode);
    const entree = auditMock.mock.calls[0].arguments[1];
    assert.deepEqual(
      { action: entree.action, tableCible: entree.tableCible, cibleId: entree.cibleId, utilisateurId: entree.utilisateurId, donnees: entree.donnees },
      { action: 'demande_dpae_envoi_planning', tableCible: 'demandes_dpae', cibleId: 7, utilisateurId, donnees: {} },
    );
    const notifications = notificationsMock.mock.calls[0].arguments[1];
    assert.deepEqual(notifications.map((n) => n.utilisateurId), PLANNING_IDS);
    assert.match(notifications[0].message, /corrigée par l'inspecteur, à valider : Sophie Martin/);
    assert.deepEqual(etat.ecritures.map(([type]) => type), ['envoi', 'audit', 'notifications']);
  }
});

test('envoi au Planning : un autre inspecteur -> 403 explicite, rien d’écrit', async (t) => {
  const { etat, envoyerMock } = mockerBase(t, 'renvoyee_inspecteur');
  await assert.rejects(
    () => envoyer('inspecteur_hotellerie', 77),
    (erreur) => erreur instanceof demandeDpaeService.ErreurEnvoiPlanningInterdit && erreur instanceof demandeDpaeService.ErreurModificationInterdite && /vos propres demandes/.test(erreur.message),
  );
  assert.equal(envoyerMock.mock.calls.length, 0);
  assert.deepEqual(etat.ecritures, []);
});

test('envoi au Planning : Planning, RH et autres rôles refusés par le service', async (t) => {
  for (const roleCode of ['planning', 'rh', 'accueil_coordination', 'formateur', 'inspecteur']) {
    const { envoyerMock } = mockerBase(t, 'renvoyee_inspecteur');
    await assert.rejects(() => envoyer(roleCode, 3), demandeDpaeService.ErreurModificationInterdite, roleCode);
    assert.equal(envoyerMock.mock.calls.length, 0);
  }
});

test('envoi au Planning : refusé (409) depuis tout autre statut que « Renvoyée à l’inspecteur », rien d’écrit', async (t) => {
  for (const statut of ['a_valider_planning', 'envoyee', 'en_attente', 'validee', 'rejetee', 'classee_sans_suite']) {
    const { etat } = mockerBase(t, statut);
    await assert.rejects(() => envoyer('admin', 1), demandeDpaeService.ErreurDemandeDejaTraitee, statut);
    assert.deepEqual(etat.ecritures, []);
  }
});

// ---------------------------------------------------------------------------------------------
// Notes sur tout statut.
// ---------------------------------------------------------------------------------------------
function mockerNotes(t, statut) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase(statut));
  return t.mock.method(notesDemandeDpaeRepository, 'ajouterNote', async () => 55);
}
const ajouter = (roleCode, auteurId) => notesDemandeDpaeService.ajouterNote(ENTITE, { demandeId: 7, contenu: 'Précision', auteurId, roleCode });

test('permissions : notes pour Admin, RH, Planning et Inspecteur Hôtellerie ; sur toute demande pour les trois premiers', () => {
  assert.deepEqual([...PERMISSIONS.dpaeNotes].sort(), ['admin', 'inspecteur_hotellerie', 'planning', 'rh']);
  assert.deepEqual([...PERMISSIONS.dpaeNotesToutes].sort(), ['admin', 'planning', 'rh']);
});

test('ajout de note possible sur tout statut, statuts finaux compris, pour Admin, Planning, RH et l’inspecteur auteur', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee', 'classee_sans_suite']) {
    for (const [roleCode, auteurId] of [['admin', 1], ['planning', 8], ['rh', 3], ['inspecteur_hotellerie', AUTEUR_ID]]) {
      // La RH ne voit pas une demande avant son envoi : tous les cas ici ont une date d'envoi.
      const ajouterMock = mockerNotes(t, statut);
      if (['a_valider_planning', 'renvoyee_inspecteur'].includes(statut) && roleCode === 'rh') {
        await assert.rejects(() => ajouter(roleCode, auteurId), demandeDpaeService.ErreurModificationInterdite);
        continue;
      }
      assert.deepEqual(await ajouter(roleCode, auteurId), { noteId: 55 }, `${roleCode} ${statut}`);
      assert.equal(ajouterMock.mock.calls.length, 1);
    }
  }
});

test('ajout de note : un inspecteur sur la demande d’un autre -> 403 explicite, rien d’écrit', async (t) => {
  for (const statut of ['envoyee', 'validee', 'classee_sans_suite']) {
    const ajouterMock = mockerNotes(t, statut);
    await assert.rejects(
      () => ajouter('inspecteur_hotellerie', 77),
      (erreur) => erreur instanceof notesDemandeDpaeService.ErreurNoteInterdite && erreur instanceof demandeDpaeService.ErreurModificationInterdite && /vos propres demandes/.test(erreur.message),
      statut,
    );
    assert.equal(ajouterMock.mock.calls.length, 0);
  }
});

test('peutAjouterNote : fonction pure', () => {
  const { peutAjouterNote } = notesDemandeDpaeService;
  const demande = { demandeur_id: 5 };
  assert.equal(peutAjouterNote({ roleCode: 'inspecteur_hotellerie', utilisateurId: 5, demande }), true);
  assert.equal(peutAjouterNote({ roleCode: 'inspecteur_hotellerie', utilisateurId: 6, demande }), false);
  for (const roleCode of ['admin', 'planning', 'rh']) assert.equal(peutAjouterNote({ roleCode, utilisateurId: 99, demande }), true, roleCode);
  for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur']) assert.equal(peutAjouterNote({ roleCode, utilisateurId: 5, demande }), false, roleCode);
});
