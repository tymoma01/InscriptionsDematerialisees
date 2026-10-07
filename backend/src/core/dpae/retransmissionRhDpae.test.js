const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const { PERMISSIONS } = require('../auth/permissions');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const statutsDpae = require('./statutsDpae');

// « Transmettre à la RH » d'une demande « En attente » une fois complétée : retour dans la file « À traiter »,
// date_envoi_rh conservée, RH notifiée, audit tracé.
const ENTITE = { id: 1, code: 'accecit' };
const AUTEUR_ID = 16;
const VERSION = 2;
const RH_IDS = [3, 4];

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
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async () => RH_IDS);
  const retransmettreMock = t.mock.method(demandeDpaeRepository, 'retransmettreALaRh', async (trx, id, parametres) => {
    trx.ecritures.push(['retransmission', id, parametres]);
    return 1;
  });
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async (trx, notifications) => {
    trx.ecritures.push(['notifications', notifications]);
  });
  return { etat, retransmettreMock, auditMock, notificationsMock };
}

const retransmettre = (roleCode, utilisateurId) =>
  demandeDpaeService.retransmettreALaRh(ENTITE, 7, utilisateurId, { version: VERSION, adresseIp: '10.0.0.1', roleCode });

// Placé en premier : les tests suivants remplacent plusieurs fois les mêmes méthodes du dépôt dans une boucle.
test('date_envoi_rh inchangée : l’UPDATE ne l’écrit pas (ni le motif), contrairement à la transmission du Planning (qui ne la pose que la première fois)', () => {
  const bd = knex({ client: 'pg' });
  const retransmission = demandeDpaeRepository.retransmettreALaRh(bd, 7, { statutDepart: 'en_attente', version: 3, statut: 'envoyee' }).toSQL();
  assert.doesNotMatch(retransmission.sql, /date_envoi_rh/);
  assert.match(retransmission.sql, /"version" = version \+ 1/);
  assert.match(retransmission.sql, /where "id" = \? and "statut" = \? and "version" = \?$/);
  assert.deepEqual(retransmission.bindings.slice(-3), [7, 'en_attente', 3]);
  const transmission = demandeDpaeRepository.transmettreALaRh(bd, 7, { statutDepart: 'a_valider_planning', version: 3, statut: 'envoyee' }).toSQL();
  assert.match(transmission.sql, /"date_envoi_rh" = COALESCE\(date_envoi_rh, now\(\)\)/);
});

test('transition : « En attente » -> « À traiter » seulement, jamais depuis un autre statut', () => {
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_RETRANSMETTRE_RH), 'dpaeRetransmissionRh');
  assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_RETRANSMETTRE_RH, 'en_attente').vers, 'envoyee');
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'validee', 'rejetee', 'classee_sans_suite']) {
    assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_RETRANSMETTRE_RH, statut), undefined, statut);
  }
  assert.deepEqual([...PERMISSIONS.dpaeRetransmissionRh].sort(), ['admin', 'inspecteur_hotellerie', 'planning']);
  assert.deepEqual([...PERMISSIONS.dpaeRetransmissionRhToutes].sort(), ['admin', 'planning']);
});

test('autorisée pour l’auteur, le Planning et l’Admin : statut « À traiter », RH notifiée « Demande complétée », audit sans motif', async (t) => {
  for (const [roleCode, utilisateurId] of [['inspecteur_hotellerie', AUTEUR_ID], ['planning', 8], ['admin', 1]]) {
    const { etat, retransmettreMock, auditMock, notificationsMock } = mockerBase(t, 'en_attente');
    await retransmettre(roleCode, utilisateurId);

    assert.deepEqual(retransmettreMock.mock.calls[0].arguments.slice(1), [7, { statutDepart: 'en_attente', version: VERSION, statut: 'envoyee' }], roleCode);
    const entree = auditMock.mock.calls[0].arguments[1];
    assert.deepEqual(
      { action: entree.action, tableCible: entree.tableCible, cibleId: entree.cibleId, utilisateurId: entree.utilisateurId, adresseIp: entree.adresseIp, donnees: entree.donnees },
      { action: 'demande_dpae_retransmission_rh', tableCible: 'demandes_dpae', cibleId: 7, utilisateurId, adresseIp: '10.0.0.1', donnees: {} },
      roleCode,
    );
    const notifications = notificationsMock.mock.calls[0].arguments[1];
    assert.deepEqual(notifications.map((n) => n.utilisateurId), RH_IDS);
    for (const notification of notifications) {
      assert.equal(notification.type, 'demande_dpae_completee');
      assert.match(notification.message, /^Demande complétée : .*Sophie Martin.*« À traiter »/);
      assert.equal(notification.lien, '/rh/dpae/7');
      assert.equal(notification.cibleId, 7);
    }
    assert.deepEqual(etat.ecritures.map(([type]) => type), ['retransmission', 'audit', 'notifications'], roleCode);
  }
});

test('un autre inspecteur : 403 explicite, rien d’écrit ni notifié', async (t) => {
  const { etat, retransmettreMock, notificationsMock } = mockerBase(t, 'en_attente');
  await assert.rejects(
    () => retransmettre('inspecteur_hotellerie', 77),
    (erreur) => erreur instanceof demandeDpaeService.ErreurRetransmissionInterdite && erreur instanceof demandeDpaeService.ErreurModificationInterdite && /vos propres demandes/.test(erreur.message),
  );
  assert.equal(retransmettreMock.mock.calls.length, 0);
  assert.equal(notificationsMock.mock.calls.length, 0);
  assert.deepEqual(etat.ecritures, []);
});

test('la RH (et les autres rôles) : refusée, la RH garde Valider et Rejeter depuis « En attente »', async (t) => {
  for (const roleCode of ['rh', 'accueil_coordination', 'formateur', 'inspecteur']) {
    const { retransmettreMock } = mockerBase(t, 'en_attente');
    await assert.rejects(() => retransmettre(roleCode, 3), demandeDpaeService.ErreurModificationInterdite, roleCode);
    assert.equal(retransmettreMock.mock.calls.length, 0);
  }
  assert.ok(statutsDpae.trouverTransition(statutsDpae.ACTION_VALIDER, 'en_attente'));
  assert.ok(statutsDpae.trouverTransition(statutsDpae.ACTION_REJETER, 'en_attente'));
});

test('refusée (409) depuis tout autre statut, rien d’écrit', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'validee', 'rejetee', 'classee_sans_suite']) {
    const { etat } = mockerBase(t, statut);
    await assert.rejects(() => retransmettre('admin', 1), demandeDpaeService.ErreurDemandeDejaTraitee, statut);
    assert.deepEqual(etat.ecritures, []);
  }
});
