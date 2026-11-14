const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const pegaseSalarieService = require('../../integrations/pegase/pegaseSalarieService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const siteAffectationRepository = require('./siteAffectationRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const entiteDpae = require('./entiteDpae');
const statutsDpae = require('./statutsDpae');
const { aPermission } = require('../auth/permissions');
const { ROLES } = require('../auth/rbac');

// Circuit DPAE du Tertiaire : le Planning Tertiaire traite lui-même les demandes du Formateur Tertiaire
// (sans RH) ; le circuit Hôtellerie reste inchangé. Base factice en mémoire, écritures compare-and-set.
const ENTITE = { id: 1, code: 'accecit' };
const COMPTES = {
  1: { role_code: 'inspecteur', role_libelle: 'Formateur Tertiaire', prenom: 'Fanny', nom: 'Martin' },
  2: { role_code: 'planning_tertiaire', role_libelle: 'Planning Tertiaire', prenom: 'Paul', nom: 'Durand' },
  3: { role_code: 'planning_tertiaire', role_libelle: 'Planning Tertiaire', prenom: 'Pia', nom: 'Dupuis' },
  4: { role_code: 'rh', role_libelle: 'RH', prenom: 'Rita', nom: 'Henry' },
  5: { role_code: 'planning', role_libelle: 'Planning Hôtellerie', prenom: 'Hugo', nom: 'Lenoir' },
  6: { role_code: 'inspecteur_hotellerie', role_libelle: 'Inspecteur Hôtellerie', prenom: 'Ines', nom: 'Roux' },
  9: { role_code: 'admin', role_libelle: 'Admin', prenom: 'Ada', nom: 'Vidal' },
};
const IDS_PAR_ROLE = { planning_tertiaire: [2, 3], rh: [4], planning: [5] };

function monter(t, demande) {
  const etat = { demande: { id: 7, version: 1, salarie_prenom: 'Léa', salarie_nom: 'Martin', date_envoi_rh: null, ...demande }, audits: [], notifications: [], notes: [], pegase: [] };
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({ fn: { now: () => 'now' } }) }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ ...etat.demande }));
  t.mock.method(demandeDpaeRepository, 'trouverUtilisateurAvecRole', async (_trx, _entiteId, id) => ({ id, actif: true, ...COMPTES[id] }));
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async (_trx, _entiteId, role) => IDS_PAR_ROLE[role] ?? []);
  const ecrire = (nouveauStatut) => async (_trx, _id, { statutDepart, version, statut }) => {
    if (etat.demande.statut !== statutDepart || etat.demande.version !== version) return 0;
    etat.demande = { ...etat.demande, statut: nouveauStatut ?? statut, version: version + 1 };
    return 1;
  };
  for (const nom of ['marquerTraitee', 'renvoyerAInspecteur', 'envoyerAuPlanning', 'classerSansSuite']) t.mock.method(demandeDpaeRepository, nom, ecrire());
  t.mock.method(demandeDpaeRepository, 'marquerEnAttente', ecrire('en_attente'));
  t.mock.method(demandeDpaeRepository, 'creerDemande', async (_trx, donnees) => {
    etat.cree = donnees;
    return 7;
  });
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _e, ids) => ids);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  t.mock.method(notesDemandeDpaeRepository, 'ajouterNote', async (_trx, note) => {
    etat.notes.push(note);
    return 55;
  });
  t.mock.method(journalAudit, 'enregistrerAction', async (_trx, entree) => etat.audits.push(entree));
  t.mock.method(notificationService, 'creerNotifications', async (_trx, liste) => etat.notifications.push(...liste));
  t.mock.method(pegaseSalarieService, 'creerSalarieDepuisDemande', async (_e, id) => etat.pegase.push(id));
  return etat;
}

const DEMANDE_TERTIAIRE = { statut: 'envoyee', division: 'tertiaire', demandeur_id: 1 };
const DEMANDE_HOTELLERIE = { statut: 'a_valider_planning', division: 'hotellerie', demandeur_id: 6 };
const options = (roleCode, plus = {}) => ({ version: 1, adresseIp: '10.0.0.1', roleCode, ...plus });
const destinataires = (etat) => etat.notifications.map((n) => n.utilisateurId).sort();

// --- Périmètres ------------------------------------------------------------------------------------
test('Entité d’une demande : Tertiaire seulement pour la division tertiaire, Hôtellerie pour toute autre (y compris vide)', () => {
  assert.equal(entiteDpae.entiteDeLaDemande({ division: 'tertiaire' }), 'tertiaire');
  for (const division of ['hotellerie', 'autre', null, undefined]) assert.equal(entiteDpae.entiteDeLaDemande({ division }), 'hotellerie', String(division));
});

test('Périmètre par rôle : Planning, RH et Inspecteur Hôtellerie -> Hôtellerie ; Planning Tertiaire et Formateur Tertiaire -> Tertiaire ; Admin -> aucune limite', () => {
  assert.deepEqual(
    ['planning', 'rh', 'inspecteur_hotellerie', 'planning_tertiaire', 'inspecteur', 'admin'].map((role) => entiteDpae.entiteDuRole(role)),
    ['hotellerie', 'hotellerie', 'hotellerie', 'tertiaire', 'tertiaire', null],
  );
});

test('Refus d’entité : messages clairs en français, aucun refus dans son périmètre ni pour l’Admin', () => {
  assert.equal(entiteDpae.messageRefusEntite('planning_tertiaire', { division: 'hotellerie' }), "Cette demande concerne l'entité Hôtellerie : elle est traitée par le Planning Hôtellerie et la RH.");
  assert.equal(entiteDpae.messageRefusEntite('planning', { division: 'tertiaire' }), "Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire.");
  assert.equal(entiteDpae.messageRefusEntite('rh', { division: 'tertiaire' }), "Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire.");
  assert.equal(entiteDpae.messageRefusEntite('admin', { division: 'tertiaire' }), null);
  assert.equal(entiteDpae.messageRefusEntite('planning_tertiaire', { division: 'tertiaire' }), null);
});

test('Droits du Planning : une seule définition, le Planning Tertiaire a les mêmes droits que le Planning Hôtellerie', () => {
  for (const cle of ['forcerStatut', 'blacklisterEmbauche', 'blacklister', 'gestionTransitions', 'gestionRendezvous', 'gestionPieces', 'dpaeCreation', 'dpaeConsultationToutes', 'dpaeClassementSansSuiteToutes', 'cloche']) {
    assert.equal(aPermission(ROLES.PLANNING_TERTIAIRE, cle), aPermission(ROLES.PLANNING, cle), cle);
  }
  // Le Planning Tertiaire traite lui-même (valider/rejeter/mettre en attente) ; le Planning Hôtellerie jamais.
  assert.equal(aPermission(ROLES.PLANNING_TERTIAIRE, 'dpaeTraitementRh'), true);
  assert.equal(aPermission(ROLES.PLANNING, 'dpaeTraitementRh'), false);
});

test('Formateur Tertiaire (code « inspecteur ») : DPAE pour créer et suivre SES demandes seulement, jamais celles des autres ni le traitement', () => {
  for (const cle of ['dpaeCreation', 'dpaeConsultation', 'dpaeModification', 'dpaeClassementSansSuite', 'dpaeEnvoiPlanning', 'dpaeNotes', 'cloche']) {
    assert.equal(aPermission(ROLES.INSPECTEUR, cle), true, cle);
  }
  for (const cle of ['dpaeConsultationToutes', 'dpaeModificationToutes', 'dpaeTraitementRh', 'dpaeValidationPlanning', 'dpaeTableauDeBord', 'dpaeNotesToutes', 'dpaeReactivation']) {
    assert.equal(aPermission(ROLES.INSPECTEUR, cle), false, cle);
  }
  assert.equal(aPermission(ROLES.INSPECTEUR_HOTELLERIE, 'dpaeCreation'), true);
  assert.notEqual(ROLES.INSPECTEUR, ROLES.INSPECTEUR_HOTELLERIE);
});

// --- Création -------------------------------------------------------------------------------------
test('Demande créée par le Formateur Tertiaire : « À traiter » chez le Planning Tertiaire, ni RH ni Planning Hôtellerie notifiés', async (t) => {
  const etat = monter(t, {});
  await demandeDpaeService.creerEtEnvoyer(ENTITE, 1, { salarieNom: 'Martin', salariePrenom: 'Léa', division: 'tertiaire', sitesAffectationIds: [10] }, { roleCode: 'inspecteur' });
  assert.equal(etat.cree.statut, 'envoyee');
  assert.deepEqual(destinataires(etat), [2, 3]);
  assert.equal(etat.notifications[0].type, 'demande_dpae_a_valider');
});

test('Demande créée par le Planning Tertiaire : « À traiter », notifie les AUTRES comptes du Planning Tertiaire', async (t) => {
  const etat = monter(t, {});
  await demandeDpaeService.creerEtEnvoyer(ENTITE, 2, { salarieNom: 'Martin', salariePrenom: 'Léa', division: 'tertiaire', sitesAffectationIds: [10] }, { roleCode: 'planning_tertiaire' });
  assert.equal(etat.cree.statut, 'envoyee');
  assert.deepEqual(destinataires(etat), [3]);
});

test('Circuit Hôtellerie inchangé à la création : Inspecteur Hôtellerie -> « À valider par le Planning », Planning Hôtellerie notifié ; Planning -> RH', async (t) => {
  let etat = monter(t, {});
  await demandeDpaeService.creerEtEnvoyer(ENTITE, 6, { salarieNom: 'M', salariePrenom: 'L', division: 'hotellerie', sitesAffectationIds: [10] }, { roleCode: 'inspecteur_hotellerie' });
  assert.equal(etat.cree.statut, 'a_valider_planning');
  assert.deepEqual(destinataires(etat), [5]);
  t.mock.restoreAll();
  etat = monter(t, {});
  await demandeDpaeService.creerEtEnvoyer(ENTITE, 5, { salarieNom: 'M', salariePrenom: 'L', division: 'hotellerie', sitesAffectationIds: [10] }, { roleCode: 'planning' });
  assert.equal(etat.cree.statut, 'envoyee');
  assert.deepEqual(destinataires(etat), [4]);
});

// --- Traitement par le Planning Tertiaire --------------------------------------------------------
test('Le Planning Tertiaire valide jusqu’au bout, sans RH : statut « Validée », auteur et formateur tracés/notifiés', async (t) => {
  const etat = monter(t, DEMANDE_TERTIAIRE);
  await demandeDpaeService.valider(ENTITE, 7, 2, options('planning_tertiaire'));
  assert.equal(etat.demande.statut, 'validee');
  assert.equal(etat.audits[0].action, 'demande_dpae_validation');
  assert.equal(etat.audits[0].utilisateurId, 2);
  assert.deepEqual(destinataires(etat), [1, 3]);
  assert.ok(etat.notifications.every((n) => !n.message.includes('RH') || n.message.includes('Planning Tertiaire')));
  assert.deepEqual(etat.pegase, [7]);
});

test('Le Planning Tertiaire rejette, met en attente puis classe sans suite, chaque action tracée avec son auteur', async (t) => {
  let etat = monter(t, DEMANDE_TERTIAIRE);
  await demandeDpaeService.rejeter(ENTITE, 7, 2, options('planning_tertiaire'));
  assert.equal(etat.demande.statut, 'rejetee');
  assert.equal(etat.audits[0].action, 'demande_dpae_rejet');
  assert.deepEqual(destinataires(etat), [1, 3]);

  t.mock.restoreAll();
  etat = monter(t, DEMANDE_TERTIAIRE);
  await demandeDpaeService.mettreEnAttente(ENTITE, 7, 2, options('planning_tertiaire'));
  assert.equal(etat.demande.statut, 'en_attente');
  assert.equal(etat.audits[0].action, 'demande_dpae_mise_en_attente');

  t.mock.restoreAll();
  etat = monter(t, DEMANDE_TERTIAIRE);
  await demandeDpaeService.classerSansSuite(ENTITE, 7, 2, options('planning_tertiaire'));
  assert.equal(etat.demande.statut, 'classee_sans_suite');
  assert.equal(etat.audits[0].action, 'demande_dpae_classement_sans_suite');
  assert.equal(etat.audits[0].utilisateurId, 2);
});

test('Une demande Tertiaire ne passe jamais par la RH : transmission à la RH refusée', async (t) => {
  monter(t, { ...DEMANDE_TERTIAIRE, statut: 'a_valider_planning' });
  await assert.rejects(() => demandeDpaeService.transmettreALaRh(ENTITE, 7, 2, options('planning_tertiaire')), (e) => e instanceof demandeDpaeService.ErreurDemandeDejaTraitee && /ne passent pas par la RH/.test(e.message));
});

// --- Refus par entité ------------------------------------------------------------------------------
test('Périmètres : le Planning Tertiaire ne traite aucune demande Hôtellerie (403 et message clair)', async (t) => {
  monter(t, { ...DEMANDE_HOTELLERIE, statut: 'envoyee' });
  for (const action of [demandeDpaeService.valider, demandeDpaeService.rejeter, demandeDpaeService.mettreEnAttente, demandeDpaeService.classerSansSuite]) {
    await assert.rejects(
      () => action(ENTITE, 7, 2, options('planning_tertiaire')),
      (e) => e instanceof demandeDpaeService.ErreurEntiteHorsPerimetre && e instanceof demandeDpaeService.ErreurModificationInterdite && e.message === "Cette demande concerne l'entité Hôtellerie : elle est traitée par le Planning Hôtellerie et la RH.",
    );
  }
});

test('Périmètres : la RH et le Planning Hôtellerie ne traitent aucune demande Tertiaire (403 et message clair)', async (t) => {
  monter(t, DEMANDE_TERTIAIRE);
  for (const [action, utilisateurId, roleCode] of [
    [demandeDpaeService.valider, 4, 'rh'],
    [demandeDpaeService.rejeter, 4, 'rh'],
    [demandeDpaeService.mettreEnAttente, 4, 'rh'],
    [demandeDpaeService.classerSansSuite, 5, 'planning'],
    [demandeDpaeService.renvoyerAInspecteur, 5, 'planning'],
  ]) {
    await assert.rejects(
      () => action(ENTITE, 7, utilisateurId, options(roleCode, { motif: 'x' })),
      (e) => e instanceof demandeDpaeService.ErreurEntiteHorsPerimetre && e.message === "Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire.",
      roleCode,
    );
  }
});

test('Périmètres : l’Admin traite les demandes des deux entités', async (t) => {
  const etat = monter(t, DEMANDE_TERTIAIRE);
  await demandeDpaeService.valider(ENTITE, 7, 9, options('admin'));
  assert.equal(etat.demande.statut, 'validee');
  t.mock.restoreAll();
  const etatHotel = monter(t, { ...DEMANDE_HOTELLERIE, statut: 'envoyee' });
  await demandeDpaeService.valider(ENTITE, 7, 9, options('admin'));
  assert.equal(etatHotel.demande.statut, 'validee');
});

test('Visibilité par entité : un rôle voit les demandes de son entité, l’Admin toutes', () => {
  const hotel = { statut: 'envoyee', division: 'hotellerie', date_envoi_rh: new Date() };
  const tertiaire = { statut: 'envoyee', division: 'tertiaire', date_envoi_rh: new Date() };
  assert.equal(demandeDpaeService.peutVoirDemande('rh', hotel), true);
  assert.equal(demandeDpaeService.peutVoirDemande('rh', tertiaire), false);
  assert.equal(demandeDpaeService.peutVoirDemande('planning_tertiaire', hotel), false);
  assert.equal(demandeDpaeService.peutVoirDemande('planning_tertiaire', tertiaire), true);
  assert.equal(demandeDpaeService.peutVoirDemande('admin', tertiaire) && demandeDpaeService.peutVoirDemande('admin', hotel), true);
});

// --- Renvoi au formateur ------------------------------------------------------------------------
test('Renvoi sans motif : refusé avec « Le motif du renvoi est obligatoire. », rien n’est modifié', async (t) => {
  const etat = monter(t, DEMANDE_TERTIAIRE);
  for (const motif of [undefined, '', '   ']) {
    await assert.rejects(
      () => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 2, options('planning_tertiaire', { motif })),
      (e) => e instanceof demandeDpaeService.ErreurMotifRenvoiObligatoire && e.message === 'Le motif du renvoi est obligatoire.',
    );
  }
  assert.equal(etat.demande.statut, 'envoyee');
  assert.deepEqual(etat.audits, []);
});

test('Renvoi au Formateur Tertiaire avec motif : « Renvoyée au formateur », motif en note et dans l’audit, formateur notifié', async (t) => {
  const etat = monter(t, DEMANDE_TERTIAIRE);
  await demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 2, options('planning_tertiaire', { motif: '  Site manquant.  ' }));
  assert.equal(etat.demande.statut, 'renvoyee_inspecteur');
  assert.deepEqual(etat.notes, [{ demandeId: 7, auteurId: 2, contenu: 'Motif du renvoi : Site manquant.' }]);
  assert.equal(etat.audits[0].action, 'demande_dpae_renvoi_inspecteur');
  assert.deepEqual(etat.audits[0].donnees, { motif: 'Site manquant.' });
  assert.equal(etat.audits[0].utilisateurId, 2);
  assert.deepEqual(destinataires(etat), [1]);
  assert.match(etat.notifications[0].message, /renvoyée au formateur par Paul DURAND \(Planning Tertiaire\)/);
});

test('Correction puis renvoi au Planning Tertiaire : le formateur renvoie, la demande repasse « À traiter » chez le Planning Tertiaire (pas de RH)', async (t) => {
  const etat = monter(t, { ...DEMANDE_TERTIAIRE, statut: 'renvoyee_inspecteur' });
  await demandeDpaeService.envoyerAuPlanning(ENTITE, 7, 1, options('inspecteur'));
  assert.equal(etat.demande.statut, 'envoyee');
  assert.equal(etat.audits[0].action, 'demande_dpae_envoi_planning');
  assert.deepEqual(destinataires(etat), [2, 3]);
});

test('Le Formateur Tertiaire ne renvoie que SA demande au Planning ; celle d’un autre auteur est refusée', async (t) => {
  monter(t, { ...DEMANDE_TERTIAIRE, statut: 'renvoyee_inspecteur', demandeur_id: 99 });
  await assert.rejects(() => demandeDpaeService.envoyerAuPlanning(ENTITE, 7, 1, options('inspecteur')), demandeDpaeService.ErreurEnvoiPlanningInterdit);
});

test('Pas de bouton « Renvoyer » possible sur une demande créée par le Planning Tertiaire : refusé par le serveur', async (t) => {
  const etat = monter(t, { ...DEMANDE_TERTIAIRE, demandeur_id: 3 });
  await assert.rejects(
    () => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 2, options('planning_tertiaire', { motif: 'Corriger' })),
    (e) => e instanceof demandeDpaeService.ErreurDemandeDejaTraitee && /créée par le Planning Tertiaire/.test(e.message),
  );
  assert.equal(etat.demande.statut, 'envoyee');
});

test('Circuit Hôtellerie inchangé : le Planning Hôtellerie renvoie depuis « À valider » sans motif, et jamais depuis « À traiter »', async (t) => {
  let etat = monter(t, DEMANDE_HOTELLERIE);
  await demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 5, options('planning'));
  assert.equal(etat.demande.statut, 'renvoyee_inspecteur');
  assert.deepEqual(etat.notes, []);
  assert.deepEqual(etat.audits[0].donnees, {});
  assert.deepEqual(destinataires(etat), [6]);

  t.mock.restoreAll();
  etat = monter(t, { ...DEMANDE_HOTELLERIE, statut: 'envoyee' });
  await assert.rejects(() => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 5, options('planning')), demandeDpaeService.ErreurDemandeDejaTraitee);
  assert.equal(etat.demande.statut, 'envoyee');
});

test('Circuit Hôtellerie inchangé : après correction, l’Inspecteur Hôtellerie renvoie au Planning (« À valider par le Planning »)', async (t) => {
  const etat = monter(t, { ...DEMANDE_HOTELLERIE, statut: 'renvoyee_inspecteur' });
  await demandeDpaeService.envoyerAuPlanning(ENTITE, 7, 6, options('inspecteur_hotellerie'));
  assert.equal(etat.demande.statut, 'a_valider_planning');
  assert.deepEqual(destinataires(etat), [5]);
});

test('Réactivation d’une demande Tertiaire classée : elle repart « À traiter » chez le Planning Tertiaire', () => {
  assert.equal(statutsDpae.statutRetourReactivation({ classee_par_role: 'planning_tertiaire' }), 'envoyee');
  assert.equal(statutsDpae.statutRetourReactivation({ classee_par_role: 'inspecteur' }), 'envoyee');
  assert.equal(statutsDpae.statutRetourReactivation({ classee_par_role: 'planning' }), 'a_valider_planning');
});

test('Le Planning Tertiaire crée une DPAE puis la valide lui-même (sans RH), chaque action tracée avec son auteur', async (t) => {
  const etat = monter(t, {});
  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE, 2, { salarieNom: 'Martin', salariePrenom: 'Léa', division: 'tertiaire', poste: 'nettoyage', sitesAffectationIds: [10] }, { roleCode: 'planning_tertiaire' });
  assert.equal(demandeId, 7);
  assert.equal(etat.cree.statut, 'envoyee');
  assert.equal(etat.cree.demandeurId, 2);

  // La demande créée est « À traiter » chez le Planning Tertiaire : il la traite jusqu'au bout.
  etat.demande = { ...etat.demande, statut: etat.cree.statut, division: 'tertiaire', demandeur_id: 2 };
  etat.audits.length = 0;
  etat.notifications.length = 0;
  await demandeDpaeService.valider(ENTITE, demandeId, 2, options('planning_tertiaire'));
  assert.equal(etat.demande.statut, 'validee');
  assert.deepEqual(etat.audits.map((e) => [e.action, e.utilisateurId]), [['demande_dpae_validation', 2]]);
  // Autre compte du Planning Tertiaire notifié, ni la RH ni le Planning Hôtellerie.
  assert.deepEqual(destinataires(etat), [3]);
});
