const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
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
    ...surcharges,
  };
}

// Demande complète renvoyée par le client (même forme que le corps du POST de création), identique à
// la demande en base : un enregistrement sans changement.
const DONNEES_SANS_CHANGEMENT = {
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

// Même demande avec un changement réel (téléphone) : seule une vraie modification s'enregistre.
const DONNEES = { ...DONNEES_SANS_CHANGEMENT, salarieTelephone: '0612345678' };

// La note de modification est toujours obligatoire : le contexte par défaut en porte une.
const CONTEXTE = { version: VERSION, utilisateurId: AUTEUR_ID, roleCode: 'planning', adresseIp: '10.0.0.1', noteModification: 'Corrigé' };

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
  const rolesDemandes = [];
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async (_trx, _entiteId, roleCode) => {
    rolesDemandes.push(roleCode);
    return rhIds;
  });
  const auditMock = t.mock.method(journalAudit, 'enregistrerAction', async (trx, entree) => {
    trx.ecritures.push(['audit', entree]);
  });
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async (trx, notifications) => {
    trx.ecritures.push(['notifications', notifications]);
  });
  const noteMock = t.mock.method(notesDemandeDpaeRepository, 'ajouterNote', async (trx, note) => {
    trx.ecritures.push(['note', note]);
    return 55;
  });
  return { etat, modifierMock, remplacerSitesMock, auditMock, notificationsMock, rolesDemandes, noteMock };
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

test('modifierDemande : « En attente » reste « En attente » (statut jamais changé), aucune notification', async (t) => {
  const { etat, modifierMock, notificationsMock } = mockerBase(t, 'en_attente');

  const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE });

  assert.equal(resultat.statut, 'en_attente');
  assert.deepEqual(
    { de: modifierMock.mock.calls[0].arguments[2].statutDepart, vers: modifierMock.mock.calls[0].arguments[2].statutArrivee },
    { de: 'en_attente', vers: 'en_attente' },
  );
  assert.equal(notificationsMock.mock.calls.length, 0);
  assert.equal(etat.ecritures.some(([genre]) => genre === 'notifications'), false);
});

test('modifierDemande : le statut ne change pour aucun rôle ni aucun statut de départ', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    for (const [roleCode, utilisateurId] of [['inspecteur_hotellerie', AUTEUR_ID], ['planning', 2], ['admin', 1]]) {
      const { modifierMock, notificationsMock } = mockerBase(t, statut);
      const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode, utilisateurId });
      assert.equal(resultat.statut, statut, `${roleCode} ${statut}`);
      assert.equal(modifierMock.mock.calls[0].arguments[2].statutArrivee, statut, `${roleCode} ${statut}`);
      assert.equal(notificationsMock.mock.calls.length, 0);
    }
  }
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

test('modifierDemande : demande, sites, audit et note enregistrés dans la même transaction, sites remplacés', async (t) => {
  const { etat } = mockerBase(t, 'envoyee');
  await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: { ...DONNEES, sitesAffectationIds: [10, 11] }, ...CONTEXTE });
  assert.deepEqual(etat.ecritures.map(([genre]) => genre), ['demande', 'sites', 'audit', 'note', 'audit']);
  assert.deepEqual(etat.ecritures[1], ['sites', 7, [10, 11]]);
});

test('modifierDemande : audit « modification » avec le statut (inchangé) et NOMS des champs modifiés, sans valeurs', async (t) => {
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
  assert.equal(entree.donnees.statut, 'en_attente');
  assert.equal('statutAvant' in entree.donnees, false);
  assert.deepEqual(entree.donnees.champsModifies.sort(), ['salarieNom', 'salarieTelephone', 'sitesAffectationIds']);
  const texte = JSON.stringify(entree.donnees);
  for (const valeur of ['Durand', '0612345678', 'Sophie']) assert.equal(texte.includes(valeur), false, valeur);
});

test('modifierDemande : une demande « À valider par le Planning » le reste, sans notification ; auteur, Planning et Admin peuvent la modifier', async (t) => {
  for (const [roleCode, utilisateurId] of [['inspecteur_hotellerie', AUTEUR_ID], ['planning', 2], ['admin', 1]]) {
    await t.test(roleCode, async (st) => {
      const { modifierMock, notificationsMock } = mockerBase(st, 'a_valider_planning');
      const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode, utilisateurId });
      assert.equal(resultat.statut, 'a_valider_planning');
      assert.equal(resultat.version, VERSION + 1);
      assert.equal(modifierMock.mock.calls[0].arguments[2].statutArrivee, 'a_valider_planning');
      assert.equal(notificationsMock.mock.calls.length, 0);
    });
  }
});

test('modifierDemande : « Renvoyée à l’inspecteur » reste « Renvoyée à l’inspecteur » : plus de passage automatique au Planning, aucune notification', async (t) => {
  const { modifierMock, notificationsMock, auditMock, rolesDemandes } = mockerBase(t, 'renvoyee_inspecteur');

  const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode: 'inspecteur_hotellerie' });

  assert.equal(resultat.statut, 'renvoyee_inspecteur');
  assert.deepEqual(
    { de: modifierMock.mock.calls[0].arguments[2].statutDepart, vers: modifierMock.mock.calls[0].arguments[2].statutArrivee },
    { de: 'renvoyee_inspecteur', vers: 'renvoyee_inspecteur' },
  );
  assert.deepEqual(rolesDemandes, []);
  assert.equal(notificationsMock.mock.calls.length, 0);
  assert.equal(auditMock.mock.calls[0].arguments[1].donnees.statut, 'renvoyee_inspecteur');
});

test('modifierDemande : échec de l’audit -> aucune écriture enregistrée (demande, sites, notification)', async (t) => {
  const { etat, auditMock } = mockerBase(t, 'en_attente');
  auditMock.mock.mockImplementation(async () => {
    throw new Error('journal_audit indisponible');
  });
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE }), /journal_audit indisponible/);
  assert.deepEqual(etat.ecritures, []);
});

test('rejeter : la notification du demandeur ne contient aucun motif et renvoie aux notes', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase('envoyee'));
  t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => 1);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const notificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  await demandeDpaeService.rejeter(ENTITE, 7, 42, { version: VERSION, adresseIp: 'x' });

  assert.equal(notificationsMock.mock.calls[0].arguments[1][0].message, 'Votre demande DPAE n° 7 a été rejetée. Consultez les notes de la demande.');
});

// ---------------------------------------------------------------------------------------------
// Note sur la modification.
// ---------------------------------------------------------------------------------------------
test('modifierDemande : note TOUJOURS obligatoire, quel que soit le statut (absente ou blanche -> refus, rien n’est écrit)', async (t) => {
  for (const statut of ['a_valider_planning', 'renvoyee_inspecteur', 'envoyee', 'en_attente']) {
    for (const donnees of [DONNEES, DONNEES_SANS_CHANGEMENT]) {
      for (const noteModification of [undefined, '', '   ']) {
        const { etat } = mockerBase(t, statut);
        await assert.rejects(
          () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees, ...CONTEXTE, noteModification }),
          demandeDpaeService.ErreurNoteModificationObligatoire,
          `${statut} ${JSON.stringify(noteModification)}`,
        );
        assert.deepEqual(etat.ecritures, []);
      }
    }
  }
});

test('modifierDemande : la note est créée dans la MÊME transaction que la modification, auteur = utilisateur connecté, marquée note de modification', async (t) => {
  const { etat, noteMock } = mockerBase(t, 'renvoyee_inspecteur');
  await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode: 'inspecteur_hotellerie', noteModification: '  Horaires du samedi précisés ' });

  assert.deepEqual(noteMock.mock.calls[0].arguments[1], { demandeId: 7, auteurId: AUTEUR_ID, contenu: 'Horaires du samedi précisés', estNoteModification: true });
  assert.deepEqual(etat.ecritures.map(([type]) => type).filter((type) => ['demande', 'note'].includes(type)), ['demande', 'note']);
  const audits = etat.ecritures.filter(([type]) => type === 'audit').map(([, entree]) => entree.action);
  assert.deepEqual(audits, ['demande_dpae_modification', 'note_demande_dpae_creation']);
});

test('modifierDemande : échec de l’écriture de la note -> la modification n’est pas enregistrée non plus', async (t) => {
  const { etat, noteMock } = mockerBase(t, 'envoyee');
  noteMock.mock.mockImplementation(async () => {
    throw new Error('notes indisponibles');
  });
  await assert.rejects(() => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, noteModification: 'x' }), /notes indisponibles/);
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande : échec de la modification -> aucune note enregistrée', async (t) => {
  const { etat, noteMock } = mockerBase(t, 'envoyee', { lignesModifiees: 0 });
  await assert.rejects(
    () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, noteModification: 'x' }),
    demandeDpaeService.ErreurDemandeModifiee,
  );
  assert.equal(noteMock.mock.calls.length, 0);
  assert.deepEqual(etat.ecritures, []);
});

test('modifierDemande : note sans aucun changement de la demande -> seule la note est enregistrée, sans nouvelle version ni notification', async (t) => {
  for (const statut of ['a_valider_planning', 'envoyee', 'renvoyee_inspecteur', 'en_attente']) {
    const { etat, modifierMock, remplacerSitesMock, notificationsMock } = mockerBase(t, statut);
    const resultat = await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES_SANS_CHANGEMENT, ...CONTEXTE, noteModification: 'Précision' });

    assert.deepEqual(resultat, { statut, version: VERSION, champsModifies: [], noteEnregistree: true }, statut);
    assert.equal(modifierMock.mock.calls.length, 0);
    assert.equal(remplacerSitesMock.mock.calls.length, 0);
    assert.equal(notificationsMock.mock.calls.length, 0);
    assert.deepEqual(etat.ecritures.map(([type]) => type), ['note', 'audit'], statut);
  }
});

test('modifierDemande : la note ne contourne pas le droit de modifier (RH, Accueil/Coordination, autre inspecteur refusés ; auteur, Planning, Admin autorisés)', async (t) => {
  for (const [roleCode, utilisateurId] of [['rh', 3], ['accueil_coordination', AUTEUR_ID], ['inspecteur_hotellerie', 77]]) {
    const { noteMock } = mockerBase(t, 'envoyee');
    await assert.rejects(
      () => demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode, utilisateurId, noteModification: 'x' }),
      demandeDpaeService.ErreurModificationInterdite,
      roleCode,
    );
    assert.equal(noteMock.mock.calls.length, 0);
  }
  for (const [roleCode, utilisateurId] of [['inspecteur_hotellerie', AUTEUR_ID], ['planning', 2], ['admin', 1]]) {
    const { noteMock } = mockerBase(t, 'renvoyee_inspecteur');
    await demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, ...CONTEXTE, roleCode, utilisateurId, noteModification: 'Corrigé' });
    assert.equal(noteMock.mock.calls[0].arguments[1].auteurId, utilisateurId, roleCode);
  }
});
