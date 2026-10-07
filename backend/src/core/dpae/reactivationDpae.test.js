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

// Réactivation d'une demande classée sans suite : Admin seulement, retour chez le rôle qui l'avait classée,
// colonnes de classement remises à NULL, date_envoi_rh jamais modifiée.
const ENTITE = { id: 1, code: 'accecit' };
const AUTEUR_ID = 16;
const VERSION = 2;
const PLANNING_IDS = [8, 9];
const RH_IDS = [3, 4];
const IDS_PAR_ROLE = { planning: PLANNING_IDS, rh: RH_IDS };

const demandeClassee = (classeeParRole, statutAvant, statut = 'classee_sans_suite') => ({
  id: 7, entite_id: 1, demandeur_id: AUTEUR_ID, statut, version: VERSION, classee_par_role: classeeParRole, statut_avant_classement: statutAvant,
  date_envoi_rh: null, salarie_nom: 'Martin', salarie_prenom: 'Sophie',
});

// Placé en premier : les tests suivants remplacent plusieurs fois les mêmes méthodes dans des boucles.
test('SQL : la réactivation remet les colonnes de classement à NULL et ne touche JAMAIS date_envoi_rh ; le classement les renseigne', () => {
  const bd = knex({ client: 'pg' });
  const reactivation = demandeDpaeRepository.reactiver(bd, 7, { statutDepart: 'classee_sans_suite', version: 3, statut: 'renvoyee_inspecteur' }).toSQL();
  assert.match(reactivation.sql, /"classee_par_role" = \?/);
  assert.match(reactivation.sql, /"statut_avant_classement" = \?/);
  assert.doesNotMatch(reactivation.sql, /date_envoi_rh/);
  assert.deepEqual(reactivation.bindings.slice(0, 3), ['renvoyee_inspecteur', null, null]);
  assert.match(reactivation.sql, /where "id" = \? and "statut" = \? and "version" = \?$/);

  const classement = demandeDpaeRepository.classerSansSuite(bd, 7, { statutDepart: 'envoyee', version: 3, statut: 'classee_sans_suite', classeeParRole: 'planning' }).toSQL();
  assert.deepEqual(classement.bindings.slice(0, 3), ['classee_sans_suite', 'planning', 'envoyee']);
  assert.doesNotMatch(classement.sql, /date_envoi_rh/);
});

test('statutRetourReactivation : inspecteur -> renvoyée ; Planning -> à valider ; Admin -> statut d’avant ; informations absentes -> à valider', () => {
  const { statutRetourReactivation } = statutsDpae;
  assert.equal(statutRetourReactivation({ classee_par_role: 'inspecteur_hotellerie', statut_avant_classement: 'envoyee' }), 'renvoyee_inspecteur');
  assert.equal(statutRetourReactivation({ classee_par_role: 'planning', statut_avant_classement: 'envoyee' }), 'a_valider_planning');
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    assert.equal(statutRetourReactivation({ classee_par_role: 'admin', statut_avant_classement: statut }), statut, statut);
  }
  for (const demande of [{}, { classee_par_role: null, statut_avant_classement: null }, { classee_par_role: 'admin', statut_avant_classement: null }, { classee_par_role: 'admin', statut_avant_classement: 'validee' }, { classee_par_role: 'rh', statut_avant_classement: 'envoyee' }]) {
    assert.equal(statutRetourReactivation(demande), 'a_valider_planning', JSON.stringify(demande));
  }
});

test('la réactivation est la seule transition sortante de « Classée sans suite », réservée à l’Admin', () => {
  assert.equal(statutsDpae.permissionPourAction(statutsDpae.ACTION_REACTIVER), 'dpaeReactivation');
  assert.deepEqual([...PERMISSIONS.dpaeReactivation], ['admin']);
  for (const statut of statutsDpae.CODES_STATUTS_DPAE.filter((code) => code !== 'classee_sans_suite')) {
    assert.equal(statutsDpae.trouverTransition(statutsDpae.ACTION_REACTIVER, statut), undefined, statut);
  }
  assert.equal(statutsDpae.STATUTS_A_DECIDER.includes('classee_sans_suite'), false);
});

function mockerBase(t, demande) {
  const etat = { ecritures: [] };
  t.mock.method(db, 'obtenirKnex', async () => ({
    transaction: async (callback) => {
      const trx = { ecritures: [] };
      const resultat = await callback(trx);
      etat.ecritures.push(...trx.ecritures);
      return resultat;
    },
  }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demande);
  const rolesDemandes = [];
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async (_trx, _entiteId, roleCode) => {
    rolesDemandes.push(roleCode);
    return IDS_PAR_ROLE[roleCode] ?? [];
  });
  const reactiverMock = t.mock.method(demandeDpaeRepository, 'reactiver', async (trx, id, parametres) => {
    trx.ecritures.push(['reactivation', id, parametres]);
    return 1;
  });
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async (trx, notifications) => {
    trx.ecritures.push(['notifications', notifications]);
  });
  return { etat, rolesDemandes, reactiverMock, auditMock, notificationsMock };
}

const reactiver = (roleCode = 'admin', utilisateurId = 1) =>
  demandeDpaeService.reactiver(ENTITE, 7, utilisateurId, { version: VERSION, adresseIp: '10.0.0.1', roleCode });

test('retour selon le rôle qui a classé : inspecteur -> renvoyée, Planning -> à valider, Admin depuis « À traiter » -> « À traiter », informations absentes -> à valider', async (t) => {
  for (const [demande, attendu] of [
    [demandeClassee('inspecteur_hotellerie', 'a_valider_planning'), 'renvoyee_inspecteur'],
    [demandeClassee('planning', 'envoyee'), 'a_valider_planning'],
    [demandeClassee('admin', 'envoyee'), 'envoyee'],
    [demandeClassee('admin', 'en_attente'), 'en_attente'],
    [demandeClassee(null, null), 'a_valider_planning'],
  ]) {
    const { reactiverMock } = mockerBase(t, demande);
    await reactiver();
    assert.deepEqual(reactiverMock.mock.calls[0].arguments.slice(1), [7, { statutDepart: 'classee_sans_suite', version: VERSION, statut: attendu }], `${demande.classee_par_role} ${demande.statut_avant_classement}`);
  }
});

test('journal_audit « demande_dpae_reactivation » avec le statut de retour ; ni date_envoi_rh ni motif écrits', async (t) => {
  const { etat, auditMock } = mockerBase(t, demandeClassee('planning', 'envoyee'));
  await reactiver();
  const entree = auditMock.mock.calls[0].arguments[1];
  assert.deepEqual(
    { action: entree.action, tableCible: entree.tableCible, cibleId: entree.cibleId, utilisateurId: entree.utilisateurId, adresseIp: entree.adresseIp, donnees: entree.donnees },
    { action: 'demande_dpae_reactivation', tableCible: 'demandes_dpae', cibleId: 7, utilisateurId: 1, adresseIp: '10.0.0.1', donnees: { statutRetour: 'a_valider_planning' } },
  );
  assert.deepEqual(etat.ecritures.map(([type]) => type), ['reactivation', 'audit', 'notifications']);
  assert.equal('date_envoi_rh' in etat.ecritures[0][2], false);
});

test('notification de la personne qui reprend la main : auteur, Planning ou RH', async (t) => {
  for (const [demande, rolesAttendus, utilisateursAttendus, type] of [
    [demandeClassee('inspecteur_hotellerie', 'envoyee'), [], [AUTEUR_ID], 'demande_dpae_renvoyee'],
    [demandeClassee('planning', 'envoyee'), ['planning'], PLANNING_IDS, 'demande_dpae_a_valider'],
    [demandeClassee('admin', 'envoyee'), ['rh'], RH_IDS, 'demande_dpae_transmise'],
    [demandeClassee('admin', 'en_attente'), ['rh'], RH_IDS, 'demande_dpae_transmise'],
  ]) {
    const { rolesDemandes, notificationsMock } = mockerBase(t, demande);
    await reactiver();
    const notifications = notificationsMock.mock.calls[0].arguments[1];
    assert.deepEqual(rolesDemandes, rolesAttendus);
    assert.deepEqual(notifications.map((n) => n.utilisateurId), utilisateursAttendus);
    for (const notification of notifications) {
      assert.equal(notification.type, type);
      assert.equal(notification.lien, '/rh/dpae/7');
      assert.equal(notification.cibleId, 7);
      assert.match(notification.message, /réactivée/);
    }
  }
});

test('Planning, RH, inspecteur et autres rôles : refus (403), rien d’écrit ni notifié', async (t) => {
  for (const roleCode of ['planning', 'rh', 'inspecteur_hotellerie', 'accueil_coordination', 'formateur', 'inspecteur']) {
    const { etat, reactiverMock, notificationsMock } = mockerBase(t, demandeClassee('planning', 'envoyee'));
    await assert.rejects(() => reactiver(roleCode, AUTEUR_ID), demandeDpaeService.ErreurModificationInterdite, roleCode);
    assert.equal(reactiverMock.mock.calls.length, 0);
    assert.equal(notificationsMock.mock.calls.length, 0);
    assert.deepEqual(etat.ecritures, []);
  }
});

test('hors « Classée sans suite » : 409, rien d’écrit', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee']) {
    const { etat } = mockerBase(t, demandeClassee(null, null, statut));
    await assert.rejects(() => reactiver(), demandeDpaeService.ErreurDemandeDejaTraitee, statut);
    assert.deepEqual(etat.ecritures, []);
  }
});

test('version obsolète : refus « modifiée entre-temps »', async (t) => {
  mockerBase(t, demandeClassee('planning', 'envoyee'));
  await assert.rejects(() => demandeDpaeService.reactiver(ENTITE, 7, 1, { version: VERSION - 1, roleCode: 'admin' }), demandeDpaeService.ErreurDemandeModifiee);
});

test('obtenirDemande d’une classée : expose le statut de retour de la réactivation ; autre statut : null', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(require('./siteAffectationRepository'), 'listerSitesDemande', async () => []);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeClassee('inspecteur_hotellerie', 'envoyee'));
  assert.equal((await demandeDpaeService.obtenirDemande(ENTITE, 7)).statut_retour_reactivation, 'renvoyee_inspecteur');
});
