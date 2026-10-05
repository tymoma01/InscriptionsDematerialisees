const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const siteAffectationRepository = require('./siteAffectationRepository');
const demandeDpaeService = require('./demandeDpaeService');

const ENTITE = { id: 1, code: 'accecit' };
const AUTEUR_ID = 16;
const VERSION = 4;

// Demande telle que la lit le repository (formes du pilote pg).
function demandeEnBase(statut, surcharges = {}) {
  return {
    id: 7,
    entite_id: 1,
    demandeur_id: AUTEUR_ID,
    statut,
    version: VERSION,
    type_demande: 'nouvelle_embauche',
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
    salarie_deja_employe: false,
    date_debut: new Date(2026, 9, 12),
    jours_concernes: [],
    semaine_type: [],
    verif_besoin_hotel: true,
    verif_tous_jours_inclus: true,
    verif_non_planification: true,
    motif_mise_en_attente: 'Pièce manquante',
    ...surcharges,
  };
}

// Demande complète renvoyée par le client (même forme que le corps du POST de création).
const DONNEES = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Sophie',
  salarieDejaEmploye: false,
  sitesAffectationIds: [10],
  dateDebut: '2026-10-12',
  verifBesoinHotel: true,
  verifTousJoursInclus: true,
  verifNonPlanification: true,
};

const CONTEXTE = { version: VERSION, utilisateurId: AUTEUR_ID, roleCode: 'planning', adresseIp: '10.0.0.1' };

// Base factice : une transaction n'enregistre ses écritures (`ecritures`) qu'en cas de succès du
// callback, comme PostgreSQL — un échec en cours de route n'en laisse aucune.
function mockerBase(t, statut, { surcharges = {}, sitesEnBase = [10], sitesValides = [10, 11], lignesModifiees = 1, rhIds = [3, 4] } = {}) {
  const etat = { ecritures: [] };
  t.mock.method(db, 'obtenirKnex', async () => ({
    transaction: async (callback) => {
      const trx = { ecritures: [] };
      const resultat = await callback(trx);
      etat.ecritures.push(...trx.ecritures);
      return resultat;
    },
  }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase(statut, surcharges));
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _entiteId, ids) => ids.filter((id) => sitesValides.includes(id)));
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => sitesEnBase.map((id) => ({ id, nom: `Site ${id}`, initiales: 'S' })));
  const modifierMock = t.mock.method(demandeDpaeRepository, 'modifierDemande', async (trx, id, parametres) => {
    if (lignesModifiees === 1) trx.ecritures.push(['demande', id, parametres]);
    return lignesModifiees;
  });
  const remplacerSitesMock = t.mock.method(siteAffectationRepository, 'remplacerSitesDemande', async (trx, id, ids) => {
    trx.ecritures.push(['sites', id, ids]);
  });
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async () => rhIds);
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async (trx, notifications) => {
    trx.ecritures.push(['notifications', notifications]);
  });
  return { etat, modifierMock, remplacerSitesMock, auditMock, notificationsMock };
}

// ---------------------------------------------------------------------------------------------
// Droit de modification : chaque rôle.
// ---------------------------------------------------------------------------------------------
test('peutModifierDemande : Planning et Admin modifient la demande de n’importe quel auteur', () => {
  for (const roleCode of ['planning', 'admin']) {
    assert.equal(demandeDpaeService.peutModifierDemande({ roleCode, utilisateurId: 1, demande: { demandeur_id: 99 } }), true, roleCode);
  }
});

test('peutModifierDemande : l’Inspecteur Hôtellerie modifie seulement SES demandes', () => {
  const { peutModifierDemande } = demandeDpaeService;
  assert.equal(peutModifierDemande({ roleCode: 'inspecteur_hotellerie', utilisateurId: 5, demande: { demandeur_id: 5 } }), true);
  assert.equal(peutModifierDemande({ roleCode: 'inspecteur_hotellerie', utilisateurId: 5, demande: { demandeur_id: 6 } }), false);
});

test('peutModifierDemande : RH, Accueil/Coordination, Formateur et Inspecteur ne modifient rien, même comme auteur', () => {
  for (const roleCode of ['rh', 'accueil_coordination', 'formateur', 'inspecteur']) {
    assert.equal(demandeDpaeService.peutModifierDemande({ roleCode, utilisateurId: 5, demande: { demandeur_id: 5 } }), false, roleCode);
  }
});

test('modifierDemande : rôle sans droit sur cette demande -> refus avant toute vérification de statut, rien n’est écrit', async (t) => {
  // Statut verrouillé EXPRÈS : un rôle sans droit ne doit pas apprendre que la demande est traitée.
  const { etat } = mockerBase(t, 'validee');
  for (const [roleCode, utilisateurId] of [['rh', 3], ['inspecteur_hotellerie', 77], ['accueil_coordination', AUTEUR_ID]]) {
    await assert.rejects(
      () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode, utilisateurId }),
      demandeDpaeService.ErreurModificationInterdite,
      roleCode,
    );
  }
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande : demande d’une autre entité ou inexistante -> introuvable', async (t) => {
  mockerBase(t, 'envoyee');
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => undefined);
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE }), demandeDpaeService.ErreurDemandeIntrouvable);
});

test('modifierDemande : l’auteur Inspecteur Hôtellerie et l’Admin sont acceptés', async (t) => {
  mockerBase(t, 'envoyee');
  for (const [roleCode, utilisateurId] of [['inspecteur_hotellerie', AUTEUR_ID], ['admin', 1], ['planning', 2]]) {
    const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode, utilisateurId });
    assert.equal(resultat.statut, 'envoyee', roleCode);
  }
});

// ---------------------------------------------------------------------------------------------
// Statuts : modifiable à « À traiter » et « En attente » seulement.
// ---------------------------------------------------------------------------------------------
test('modifierDemande : « À traiter » reste « À traiter », version incrémentée, aucune notification', async (t) => {
  const { modifierMock, remplacerSitesMock, notificationsMock } = mockerBase(t, 'envoyee');

  const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE });

  assert.equal(resultat.statut, 'envoyee');
  assert.equal(resultat.version, VERSION + 1);
  const [, id, parametres] = modifierMock.mock.calls[0].arguments;
  assert.equal(id, 7);
  assert.deepEqual(
    { statutDepart: parametres.statutDepart, version: parametres.version, statutArrivee: parametres.statutArrivee },
    { statutDepart: 'envoyee', version: VERSION, statutArrivee: 'envoyee' },
  );
  // Les sites ne sont pas transmis à la mise à jour de la demande : ils ont leur propre écriture.
  assert.equal('sitesAffectationIds' in parametres.donnees, false);
  assert.deepEqual(remplacerSitesMock.mock.calls[0].arguments.slice(1), [7, [10]]);
  assert.equal(notificationsMock.mock.calls.length, 0);
});

test('modifierDemande : « En attente » repasse « À traiter » et la RH reçoit « Demande complétée »', async (t) => {
  const { etat, modifierMock, notificationsMock } = mockerBase(t, 'en_attente');

  const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE });

  assert.equal(resultat.statut, 'envoyee');
  assert.deepEqual(
    { de: modifierMock.mock.calls[0].arguments[2].statutDepart, vers: modifierMock.mock.calls[0].arguments[2].statutArrivee },
    { de: 'en_attente', vers: 'envoyee' },
  );
  const notifications = notificationsMock.mock.calls[0].arguments[1];
  assert.deepEqual(notifications.map((n) => n.utilisateurId), [3, 4]);
  for (const notification of notifications) {
    assert.equal(notification.type, 'demande_dpae_completee');
    assert.match(notification.message, /^Demande complétée : /);
    assert.equal(notification.lien, '/rh/dpae/7');
    assert.equal(notification.cibleId, 7);
  }
  assert.ok(etat.ecritures.some(([genre]) => genre === 'notifications'));
});

test('modifierDemande : le motif d’attente n’est pas effacé (conservé en base), seul le statut revient à « À traiter »', async (t) => {
  const { modifierMock } = mockerBase(t, 'en_attente');
  await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE });
  const { donnees } = modifierMock.mock.calls[0].arguments[2];
  assert.equal('motifMiseEnAttente' in donnees, false);
  assert.equal('motif_mise_en_attente' in donnees, false);
});

test('modifierDemande : demande « Validée » ou « Rejetée » verrouillée -> refus, rien n’est écrit', async (t) => {
  for (const statut of ['validee', 'rejetee']) {
    await t.test(statut, async (st) => {
      const { etat, modifierMock } = mockerBase(st, statut);
      await assert.rejects(
        () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE }),
        (erreur) => erreur instanceof demandeDpaeService.ErreurDemandeDejaTraitee && /n'est plus modifiable/.test(erreur.message),
      );
      assert.equal(modifierMock.mock.calls.length, 0);
      assert.deepEqual(etat.ecritures, []);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Verrouillage optimiste.
// ---------------------------------------------------------------------------------------------
test('modifierDemande : version obsolète -> refus « modifiée entre-temps », rien n’est écrit', async (t) => {
  const { etat, modifierMock } = mockerBase(t, 'envoyee');
  await assert.rejects(
    () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, version: VERSION - 1 }),
    (erreur) => erreur instanceof demandeDpaeService.ErreurDemandeModifiee && erreur.message === 'Cette demande a été modifiée entre-temps. Rechargez-la.',
  );
  assert.equal(modifierMock.mock.calls.length, 0);
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande : écriture conditionnelle sans ligne modifiée (changement concurrent) -> refus, ni sites ni audit ni notification', async (t) => {
  const { etat, remplacerSitesMock, auditMock } = mockerBase(t, 'en_attente', { lignesModifiees: 0 });
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE }), demandeDpaeService.ErreurDemandeModifiee);
  assert.equal(remplacerSitesMock.mock.calls.length, 0);
  assert.equal(auditMock.mock.calls.length, 0);
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande sans version (appel interne) -> refus', async (t) => {
  mockerBase(t, 'envoyee');
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, version: undefined }), /version de la demande est obligatoire/);
});

// ---------------------------------------------------------------------------------------------
// Sites, audit, atomicité.
// ---------------------------------------------------------------------------------------------
test('modifierDemande : site inexistant, inactif ou d’une autre entité -> 400 côté route, rien n’est écrit', async (t) => {
  const { etat } = mockerBase(t, 'envoyee');
  await assert.rejects(
    () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: { ...DONNEES, sitesAffectationIds: [10, 99] }, ...CONTEXTE }),
    (erreur) => erreur instanceof demandeDpaeService.ErreurSitesAffectationInvalides && /: 99\./.test(erreur.message),
  );
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande : demande, sites et audit enregistrés dans la même transaction, sites remplacés', async (t) => {
  const { etat } = mockerBase(t, 'envoyee');
  await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: { ...DONNEES, sitesAffectationIds: [10, 11] }, ...CONTEXTE });
  assert.deepEqual(etat.ecritures.map(([genre]) => genre), ['demande', 'sites', 'audit']);
  assert.deepEqual(etat.ecritures[1], ['sites', 7, [10, 11]]);
});

test('modifierDemande : audit « modification » avec statut avant/après et NOMS des champs modifiés, sans valeurs', async (t) => {
  const { auditMock } = mockerBase(t, 'en_attente', { sitesEnBase: [10] });

  await demandeDpaeService.modifierDemande(ENTITE, 7, {
    donnees: { ...DONNEES, salarieNom: 'Durand', salarieTelephone: '0612345678', sitesAffectationIds: [10, 11] },
    ...CONTEXTE,
  });

  const entree = auditMock.mock.calls[0].arguments[1];
  assert.equal(entree.action, 'demande_dpae_modification');
  assert.equal(entree.tableCible, 'demandes_dpae');
  assert.equal(entree.cibleId, 7);
  assert.equal(entree.utilisateurId, AUTEUR_ID);
  assert.equal(entree.adresseIp, '10.0.0.1');
  assert.equal(entree.donnees.statutAvant, 'en_attente');
  assert.equal(entree.donnees.statutApres, 'envoyee');
  assert.deepEqual(entree.donnees.champsModifies.sort(), ['salarieNom', 'salarieTelephone', 'sitesAffectationIds']);
  const texte = JSON.stringify(entree.donnees);
  for (const valeur of ['Durand', '0612345678', 'Sophie']) assert.equal(texte.includes(valeur), false, valeur);
});

test('modifierDemande : aucune modification réelle -> audit avec liste de champs vide (la demande reste valide)', async (t) => {
  const { auditMock } = mockerBase(t, 'envoyee');
  await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE });
  assert.deepEqual(auditMock.mock.calls[0].arguments[1].donnees.champsModifies, []);
});

test('modifierDemande : échec de l’audit -> aucune écriture enregistrée (demande, sites, notification)', async (t) => {
  const { etat, auditMock } = mockerBase(t, 'en_attente');
  auditMock.mock.mockImplementation(async () => {
    throw new Error('journal_audit indisponible');
  });
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE }), /journal_audit indisponible/);
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande : échec de la notification de la RH -> aucune écriture enregistrée', async (t) => {
  const { etat, notificationsMock } = mockerBase(t, 'en_attente');
  notificationsMock.mock.mockImplementation(async () => {
    throw new Error('notifications indisponibles');
  });
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE }), /notifications indisponibles/);
  assert.deepEqual(etat.ecritures, []);
});

test('rejeter : la notification du demandeur contient le motif du rejet', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase('envoyee'));
  t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => 1);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  await demandeDpaeService.rejeter(ENTITE, 7, 42, '  Poste déjà pourvu ', { version: VERSION, adresseIp: 'x' });

  assert.match(notificationsMock.mock.calls[0].arguments[1][0].message, /a été rejetée par la RH : Poste déjà pourvu$/);
});
