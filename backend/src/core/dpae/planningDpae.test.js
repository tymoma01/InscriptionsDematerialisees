const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const siteAffectationRepository = require('./siteAffectationRepository');

// Passage des demandes des inspecteurs par le Planning : création, transitions (transmettre,
// renvoyer), visibilité de la RH et notifications de chaque étape. Base factice : les écritures ne
// sont gardées que si la transaction réussit, comme PostgreSQL.
const ENTITE = { id: 1, code: 'accecit' };
const AUTEUR_ID = 16;
const PLANNING_IDS = [8, 9];
const RH_IDS = [3, 4];
const IDS_PAR_ROLE = { planning: PLANNING_IDS, rh: RH_IDS };

function demandeEnBase(statut, version = 2) {
  return { id: 7, entite_id: 1, demandeur_id: AUTEUR_ID, statut, version, salarie_nom: 'Martin', salarie_prenom: 'Sophie' };
}

function mockerBase(t, statut, { version = 2 } = {}) {
  const etat = { ecritures: [] };
  t.mock.method(db, 'obtenirKnex', async () => ({
    transaction: async (callback) => {
      const trx = { ecritures: [] };
      const resultat = await callback(trx);
      etat.ecritures.push(...trx.ecritures);
      return resultat;
    },
  }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase(statut, version));
  const rolesDemandes = [];
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async (_trx, _entiteId, roleCode) => {
    rolesDemandes.push(roleCode);
    return IDS_PAR_ROLE[roleCode] ?? [];
  });
  const transmettreMock = t.mock.method(demandeDpaeRepository, 'transmettreALaRh', async (trx, id, parametres) => {
    trx.ecritures.push(['transmission', id, parametres]);
    return 1;
  });
  const renvoyerMock = t.mock.method(demandeDpaeRepository, 'renvoyerAInspecteur', async (trx, id, parametres) => {
    trx.ecritures.push(['renvoi', id, parametres]);
    return 1;
  });
  const marquerMock = t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => 1);
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async (trx, notifications) => {
    trx.ecritures.push(['notifications', notifications]);
  });
  return { etat, rolesDemandes, transmettreMock, renvoyerMock, marquerMock, auditMock, notificationsMock };
}

// ---------------------------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------------------------
function mockerCreation(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _entiteId, ids) => ids);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  const creerMock = t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  const rolesDemandes = [];
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async (_trx, _entiteId, roleCode) => {
    rolesDemandes.push(roleCode);
    return IDS_PAR_ROLE[roleCode] ?? [];
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});
  return { creerMock, rolesDemandes, notificationsMock };
}

const DONNEES = { salarieNom: 'Martin', salariePrenom: 'Sophie', sitesAffectationIds: [10] };

test('création par un Inspecteur Hôtellerie : statut « À valider par le Planning », et les utilisateurs Planning sont notifiés', async (t) => {
  const { creerMock, rolesDemandes, notificationsMock } = mockerCreation(t);

  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE, AUTEUR_ID, DONNEES, { roleCode: 'inspecteur_hotellerie' });

  assert.equal(demandeId, 7);
  assert.equal(creerMock.mock.calls[0].arguments[1].statut, 'a_valider_planning');
  assert.deepEqual(rolesDemandes, ['planning']);
  const notifications = notificationsMock.mock.calls[0].arguments[1];
  assert.deepEqual(notifications.map((n) => n.utilisateurId), PLANNING_IDS);
  for (const notification of notifications) {
    assert.equal(notification.type, 'demande_dpae_a_valider');
    assert.match(notification.message, /Sophie Martin/);
    assert.equal(notification.lien, '/rh/dpae/7');
    assert.equal(notification.cibleId, 7);
    assert.equal(notification.entiteId, 1);
  }
});

test('création par un autre rôle (Planning, Admin) : statut « À traiter », aucune notification', async (t) => {
  const { creerMock, notificationsMock } = mockerCreation(t);
  for (const roleCode of ['planning', 'admin']) {
    await demandeDpaeService.creerEtEnvoyer(ENTITE, 5, DONNEES, { roleCode });
  }
  assert.deepEqual(creerMock.mock.calls.map((appel) => appel.arguments[1].statut), ['envoyee', 'envoyee']);
  assert.equal(notificationsMock.mock.calls.length, 0);
});

test('creerDemande : une demande « À valider » n’a pas de date d’envoi à la RH ; « À traiter » l’a, posée à l’instant', async () => {
  const insertions = [];
  const trx = () => ({
    insert(valeurs) {
      insertions.push(valeurs);
      return { returning: async () => [{ id: 7 }] };
    },
  });
  trx.fn = { now: () => 'MAINTENANT' };

  await demandeDpaeRepository.creerDemande(trx, { entiteId: 1, demandeurId: 16, statut: 'a_valider_planning', salarieNom: 'Martin' });
  await demandeDpaeRepository.creerDemande(trx, { entiteId: 1, demandeurId: 16, salarieNom: 'Martin' });

  assert.deepEqual(insertions.map((valeurs) => [valeurs.statut, valeurs.date_envoi_rh]), [
    ['a_valider_planning', null],
    ['envoyee', 'MAINTENANT'],
  ]);
});

// ---------------------------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------------------------
test('transmettre à la RH : « À valider » -> « À traiter », date d’envoi posée, RH et inspecteur auteur notifiés, action tracée', async (t) => {
  const { etat, transmettreMock, auditMock, notificationsMock } = mockerBase(t, 'a_valider_planning');

  await demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, { version: 2, adresseIp: '10.0.0.1', roleCode: 'planning' });

  assert.deepEqual(transmettreMock.mock.calls[0].arguments.slice(1), [7, { statutDepart: 'a_valider_planning', version: 2, statut: 'envoyee' }]);
  const entree = auditMock.mock.calls[0].arguments[1];
  assert.equal(entree.action, 'demande_dpae_transmission_rh');
  assert.equal(entree.utilisateurId, 8);
  assert.equal(entree.adresseIp, '10.0.0.1');
  const notifications = notificationsMock.mock.calls[0].arguments[1];
  assert.deepEqual(notifications.map((n) => n.utilisateurId), [...RH_IDS, AUTEUR_ID]);
  assert.match(notifications[0].message, /Nouvelle demande DPAE à traiter : Sophie Martin/);
  assert.match(notifications.at(-1).message, /transmise à la RH par le Planning/);
  assert.equal(etat.ecritures.length, 3);
});

test('renvoyer à l’inspecteur : « À valider » -> « Renvoyée », sans motif, inspecteur auteur notifié sans motif, action tracée sans motif', async (t) => {
  const { renvoyerMock, auditMock, notificationsMock } = mockerBase(t, 'a_valider_planning');

  await demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 8, { version: 2, adresseIp: '10.0.0.1', roleCode: 'planning' });

  assert.deepEqual(renvoyerMock.mock.calls[0].arguments.slice(1), [7, { statutDepart: 'a_valider_planning', version: 2, statut: 'renvoyee_inspecteur' }]);
  const entree = auditMock.mock.calls[0].arguments[1];
  assert.equal(entree.action, 'demande_dpae_renvoi_inspecteur');
  assert.deepEqual(entree.donnees, {});
  const notifications = notificationsMock.mock.calls[0].arguments[1];
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].utilisateurId, AUTEUR_ID);
  assert.equal(notifications[0].message, 'Votre demande DPAE n° 7 a été renvoyée. Consultez les notes de la demande.');
});

test('transmettre ou renvoyer hors « À valider par le Planning » -> refus, rien n’est écrit ni notifié', async (t) => {
  for (const statut of ['renvoyee_inspecteur', 'envoyee', 'en_attente', 'validee', 'rejetee']) {
    await t.test(statut, async (st) => {
      const { etat, transmettreMock, renvoyerMock } = mockerBase(st, statut);
      await assert.rejects(() => demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, { version: 2, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeDejaTraitee);
      await assert.rejects(() => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 8, { version: 2, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeDejaTraitee);
      assert.equal(transmettreMock.mock.calls.length + renvoyerMock.mock.calls.length, 0);
      assert.deepEqual(etat.ecritures, []);
    });
  }
});

test('le Planning ne peut pas rejeter (ni valider, ni mettre en attente) une demande « À valider » ou « Renvoyée »', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur']) {
    await t.test(statut, async (st) => {
      const { etat, marquerMock } = mockerBase(st, statut);
      await assert.rejects(() => demandeDpaeService.rejeter(ENTITE, 7, 8, { version: 2, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeDejaTraitee);
      await assert.rejects(() => demandeDpaeService.valider(ENTITE, 7, 8, { version: 2, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeDejaTraitee);
      await assert.rejects(() => demandeDpaeService.mettreEnAttente(ENTITE, 7, 8, { version: 2, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeDejaTraitee);
      assert.equal(marquerMock.mock.calls.length, 0);
      assert.deepEqual(etat.ecritures, []);
    });
  }
});

test('RH : toute action (valider, rejeter, mettre en attente, transmettre, renvoyer) sur une demande « À valider » ou « Renvoyée » -> 403, avant tout contrôle de version ou de transition, rien d’écrit', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur']) {
    await t.test(statut, async (st) => {
      // Version volontairement obsolète : le refus 403 doit passer avant le contrôle de version.
      const { etat, marquerMock, transmettreMock, renvoyerMock } = mockerBase(st, statut, { version: 5 });
      const options = { version: 1, roleCode: 'rh' };
      for (const appel of [
        () => demandeDpaeService.valider(ENTITE, 7, 3, options),
        () => demandeDpaeService.rejeter(ENTITE, 7, 3, options),
        () => demandeDpaeService.mettreEnAttente(ENTITE, 7, 3, options),
        () => demandeDpaeService.transmettreALaRh(ENTITE, 7, 3, options),
        () => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 3, options),
      ]) {
        await assert.rejects(appel, demandeDpaeService.ErreurModificationInterdite);
      }
      assert.equal(marquerMock.mock.calls.length + transmettreMock.mock.calls.length + renvoyerMock.mock.calls.length, 0);
      assert.deepEqual(etat.ecritures, []);
    });
  }
});

test('transmettre : version obsolète -> refus « modifiée entre-temps », rien n’est écrit', async (t) => {
  const { etat } = mockerBase(t, 'a_valider_planning', { version: 5 });
  await assert.rejects(() => demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, { version: 4, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeModifiee);
  assert.deepEqual(etat.ecritures, []);
});

test('transmettre : si l’écriture gardée ne touche aucune ligne (décision concurrente) -> refus, ni audit ni notification', async (t) => {
  const { etat, transmettreMock } = mockerBase(t, 'a_valider_planning');
  transmettreMock.mock.mockImplementation(async () => 0);
  await assert.rejects(() => demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, { version: 2, roleCode: 'planning' }), demandeDpaeService.ErreurDemandeModifiee);
  assert.deepEqual(etat.ecritures, []);
});

// ---------------------------------------------------------------------------------------------
// Droits
// ---------------------------------------------------------------------------------------------
test('permissions : transmettre/renvoyer réservés au Planning et à l’Admin ; création soumise au Planning pour l’Inspecteur Hôtellerie seul', () => {
  const { aPermission } = require('../auth/permissions');
  for (const roleCode of ['planning', 'admin']) assert.equal(aPermission(roleCode, 'dpaeValidationPlanning'), true, roleCode);
  for (const roleCode of ['rh', 'inspecteur_hotellerie', 'accueil_coordination', 'formateur', 'inspecteur']) {
    assert.equal(aPermission(roleCode, 'dpaeValidationPlanning'), false, roleCode);
  }
  assert.equal(aPermission('inspecteur_hotellerie', 'dpaeCreationSoumiseAuPlanning'), true);
  for (const roleCode of ['planning', 'admin', 'rh']) assert.equal(aPermission(roleCode, 'dpaeCreationSoumiseAuPlanning'), false, roleCode);
  // Cloche : Planning et Inspecteur Hôtellerie en plus de l'Admin et de la RH.
  for (const roleCode of ['admin', 'rh', 'planning', 'inspecteur_hotellerie']) assert.equal(aPermission(roleCode, 'cloche'), true, roleCode);
  for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur']) assert.equal(aPermission(roleCode, 'cloche'), false, roleCode);
});

// ---------------------------------------------------------------------------------------------
// Visibilité : la RH ne voit pas les deux statuts d'avant l'envoi à la RH
// ---------------------------------------------------------------------------------------------
test('RH aveugle : fiche non consultable aux statuts « À valider » et « Renvoyée », consultable aux autres', () => {
  const { peutConsulterDemande } = demandeDpaeService;
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur']) {
    assert.equal(peutConsulterDemande({ roleCode: 'rh', utilisateurId: 3, demande: { statut, demandeur_id: AUTEUR_ID } }), false, statut);
    for (const roleCode of ['admin', 'planning', 'inspecteur_hotellerie']) {
      assert.equal(peutConsulterDemande({ roleCode, utilisateurId: AUTEUR_ID, demande: { statut, demandeur_id: AUTEUR_ID } }), true, `${roleCode} ${statut}`);
    }
  }
  for (const statut of ['envoyee', 'en_attente', 'validee', 'rejetee']) {
    assert.equal(peutConsulterDemande({ roleCode: 'rh', utilisateurId: 3, demande: { statut, demandeur_id: AUTEUR_ID } }), true, statut);
  }
});

test('statutsMasquesPour : les deux statuts du Planning pour la RH, aucun pour Admin, Planning et Inspecteur Hôtellerie', () => {
  assert.deepEqual([...demandeDpaeService.statutsMasquesPour('rh')], ['a_valider_planning', 'renvoyee_inspecteur']);
  for (const roleCode of ['admin', 'planning', 'inspecteur_hotellerie']) assert.deepEqual(demandeDpaeService.statutsMasquesPour(roleCode), [], roleCode);
});

test('listes : la RH et son suivi excluent les deux statuts ; la file RH les exclut pour tous ; le suivi de l’Admin et du Planning n’exclut rien', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const toutesMock = t.mock.method(demandeDpaeRepository, 'listerDemandesPourRh', async () => []);
  const miennesMock = t.mock.method(demandeDpaeRepository, 'listerDemandesParDemandeur', async () => []);
  t.mock.method(siteAffectationRepository, 'listerSitesParDemandes', async () => []);
  const AVANT_RH = ['a_valider_planning', 'renvoyee_inspecteur'];

  await demandeDpaeService.listerSuivi(ENTITE, { utilisateurId: 3, roleCode: 'rh' });
  await demandeDpaeService.listerSuivi(ENTITE, { utilisateurId: 8, roleCode: 'planning' });
  await demandeDpaeService.listerSuivi(ENTITE, { utilisateurId: 3, roleCode: 'rh', perimetreDemande: 'mes' });
  await demandeDpaeService.listerPourRh(ENTITE, null);

  assert.deepEqual(toutesMock.mock.calls.map((appel) => appel.arguments[3]), [AVANT_RH, [], AVANT_RH]);
  assert.deepEqual(miennesMock.mock.calls.map((appel) => appel.arguments[3]), [AVANT_RH]);
});

test('file « Demandes à valider » : demandes des deux statuts avec leurs sites', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const listerMock = t.mock.method(demandeDpaeRepository, 'listerDemandesAValider', async () => [
    { id: 7, statut: 'a_valider_planning' },
    { id: 8, statut: 'renvoyee_inspecteur' },
  ]);
  t.mock.method(siteAffectationRepository, 'listerSitesParDemandes', async () => [{ demande_dpae_id: 8, id: 10, nom: 'AIGLON', initiales: 'AIG' }]);

  const demandes = await demandeDpaeService.listerAValider(ENTITE);

  assert.equal(listerMock.mock.calls[0].arguments[1], 1);
  assert.deepEqual(demandes.map((d) => [d.id, d.sites_affectation.length]), [[7, 0], [8, 1]]);
});

test('file « Demandes à valider » (SQL) : uniquement les deux statuts, « À valider » d’abord, premier jour le plus proche d’abord', () => {
  const { sql, bindings } = demandeDpaeRepository.listerDemandesAValider(knex({ client: 'pg' }), 1).toSQL();
  assert.match(sql, /"demandes_dpae"\."statut" in \(\?, \?\)/);
  assert.deepEqual(bindings.slice(-2), ['a_valider_planning', 'renvoyee_inspecteur']);
  assert.match(sql, /CASE demandes_dpae\.statut WHEN 'a_valider_planning' THEN 0 WHEN 'renvoyee_inspecteur' THEN 1 END/);
  assert.match(sql, /demandes_dpae\.date_debut ASC NULLS LAST/);
});

test('listes SQL : les statuts exclus sont écartés (whereNotIn) ; aucune exclusion sans statuts', () => {
  const bd = knex({ client: 'pg' });
  const avec = demandeDpaeRepository.listerDemandesPourRh(bd, 1, null, ['a_valider_planning', 'renvoyee_inspecteur']).toSQL();
  assert.match(avec.sql, /"demandes_dpae"\."statut" not in \(\?, \?\)/);
  const sans = demandeDpaeRepository.listerDemandesPourRh(bd, 1, null).toSQL();
  assert.doesNotMatch(sans.sql, /not in/);
});

test('transmission et renvoi (SQL) : compare-and-set sur id, statut ET version ; date d’envoi posée seulement à la transmission', () => {
  const bd = knex({ client: 'pg' });
  const transmission = demandeDpaeRepository.transmettreALaRh(bd, 7, { statutDepart: 'a_valider_planning', version: 3, statut: 'envoyee' }).toSQL();
  assert.match(transmission.sql, /"date_envoi_rh" = CURRENT_TIMESTAMP/);
  assert.match(transmission.sql, /"version" = version \+ 1/);
  assert.match(transmission.sql, /where "id" = \? and "statut" = \? and "version" = \?$/);
  assert.deepEqual(transmission.bindings.slice(-3), [7, 'a_valider_planning', 3]);

  const renvoi = demandeDpaeRepository.renvoyerAInspecteur(bd, 7, { statutDepart: 'a_valider_planning', version: 3, statut: 'renvoyee_inspecteur' }).toSQL();
  assert.doesNotMatch(renvoi.sql, /date_envoi_rh/);
  assert.doesNotMatch(renvoi.sql, /motif_renvoi/);
  assert.match(renvoi.sql, /where "id" = \? and "statut" = \? and "version" = \?$/);
});
