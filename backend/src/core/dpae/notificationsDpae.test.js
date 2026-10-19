const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../audit/journalAudit');
const notificationService = require('../notifications/notificationService');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const siteAffectationRepository = require('./siteAffectationRepository');
const notesDemandeDpaeRepository = require('./notesDemandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const notesDemandeDpaeService = require('./notesDemandeDpaeService');
const notificationsDpae = require('./notificationsDpae');
const { mockerUtilisateurs } = require('./utilisateursDpaeFactices');

// Destinataires de chaque action sur une demande : parties concernées, auteur exclu, aucun doublon,
// Planning seulement dans le circuit Planning, RH seulement si la demande lui a été envoyée.
const ENTITE = { id: 1, code: 'accecit' };
const VERSION = 2;
const INSPECTEUR = 16; // demandeur dans le circuit Planning
const PLANNING = [8, 9];
const RH = [3, 4];
const ADMIN = 1;
const DEMANDEUR_DIRECT = 5; // demande envoyée directement à la RH (hors circuit Planning)
const DATE_RH = new Date('2026-10-01T10:00:00Z');

const UTILISATEURS = {
  [INSPECTEUR]: { role_code: 'inspecteur_hotellerie', role_libelle: 'Inspecteur Hôtellerie' },
  8: { role_code: 'planning', role_libelle: 'Planning' },
  9: { role_code: 'planning', role_libelle: 'Planning' },
  3: { role_code: 'rh', role_libelle: 'RH' },
  4: { role_code: 'rh', role_libelle: 'RH' },
  [ADMIN]: { role_code: 'admin', role_libelle: 'Admin' },
  [DEMANDEUR_DIRECT]: { role_code: 'planning', role_libelle: 'Planning', prenom: 'Paul' },
};

const demande = (statut, { demandeurId = INSPECTEUR, envoyeeALaRh = false, classeeParRole = null, statutAvant = null } = {}) => ({
  id: 7,
  entite_id: 1,
  demandeur_id: demandeurId,
  statut,
  version: VERSION,
  date_envoi_rh: envoyeeALaRh ? DATE_RH : null,
  classee_par_role: classeeParRole,
  statut_avant_classement: statutAvant,
  salarie_nom: 'Martin',
  salarie_prenom: 'Sophie',
  type_demande: 'nouvelle_embauche',
});

// Joue `action` sur la demande donnée et renvoie les identifiants notifiés (ordre de création) et les notifications.
async function jouer(t, demandeEnBase, action) {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeEnBase);
  mockerUtilisateurs(t, UTILISATEURS);
  t.mock.method(demandeDpaeRepository, 'listerIdsUtilisateursActifsParRole', async (_trx, _entiteId, roleCode) => ({ planning: PLANNING, rh: RH })[roleCode] ?? []);
  for (const nom of ['marquerTraitee', 'marquerEnAttente', 'transmettreALaRh', 'renvoyerAInspecteur', 'classerSansSuite', 'reactiver', 'envoyerAuPlanning', 'retransmettreALaRh', 'modifierDemande']) {
    t.mock.method(demandeDpaeRepository, nom, async () => 1);
  }
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _entiteId, ids) => ids);
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => [{ id: 10 }]);
  t.mock.method(siteAffectationRepository, 'remplacerSitesDemande', async () => {});
  t.mock.method(notesDemandeDpaeRepository, 'ajouterNote', async () => 55);
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const creerMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  await action();
  const notifications = creerMock.mock.calls.flatMap((appel) => appel.arguments[1]);
  return { ids: notifications.map((n) => n.utilisateurId), notifications };
}

const options = (roleCode) => ({ version: VERSION, adresseIp: '10.0.0.1', roleCode });
const trier = (ids) => [...ids].sort((a, b) => a - b);

test('choisirDestinataires : un utilisateur à la fois demandeur et Planning ne reçoit qu’une notification, l’auteur jamais', () => {
  const demandeur = { id: 8, actif: true };
  const ids = notificationsDpae.choisirDestinataires({
    parties: ['demandeur', 'planning', 'rh'],
    auteurId: 3,
    demandeur,
    circuitPlanning: true,
    envoyeeALaRh: true,
    idsPlanning: [8, 9],
    idsRh: [3, 4],
  });
  assert.deepEqual(ids, [8, 9, 4]);
});

test('choisirDestinataires : demandeur inactif ignoré', () => {
  const ids = notificationsDpae.choisirDestinataires({ parties: ['demandeur'], auteurId: 1, demandeur: { id: 5, actif: false }, circuitPlanning: false, envoyeeALaRh: false, idsPlanning: [], idsRh: [] });
  assert.deepEqual(ids, []);
});

test('extraireNote : 80 premiers caractères sur une seule ligne', () => {
  assert.equal(notificationsDpae.extraireNote('court\nsur  deux lignes'), 'court sur deux lignes');
  const longue = 'a'.repeat(200);
  assert.equal(notificationsDpae.extraireNote(longue), `${'a'.repeat(80)}…`);
});

test('message : « DPAE n° X – Prénom NOM : action par Prénom NOM (Rôle) », lien vers la fiche', async (t) => {
  const { notifications } = await jouer(t, demande('envoyee', { envoyeeALaRh: true }), () => demandeDpaeService.valider(ENTITE, 7, 3, options('rh')));
  assert.equal(notifications[0].message, 'DPAE n° 7 – Sophie MARTIN : validée par Alice DURAND3 (RH)');
  assert.equal(notifications[0].lien, '/rh/dpae/7');
  assert.equal(notifications[0].tableCible, 'demandes_dpae');
  assert.equal(notifications[0].cibleId, 7);
});

// ---------------------------------------------------------------------------------------------
// Décisions de la RH : demandeur + Planning (circuit Planning seulement)
// ---------------------------------------------------------------------------------------------
for (const [nom, appel] of [
  ['valider', (...a) => demandeDpaeService.valider(...a)],
  ['rejeter', (...a) => demandeDpaeService.rejeter(...a)],
  ['mettreEnAttente', (...a) => demandeDpaeService.mettreEnAttente(...a)],
]) {
  test(`${nom} : demandeur + Planning dans le circuit Planning, la RH auteur exclue`, async (t) => {
    const { ids } = await jouer(t, demande('envoyee', { envoyeeALaRh: true }), () => appel(ENTITE, 7, 3, options('rh')));
    assert.deepEqual(trier(ids), trier([INSPECTEUR, ...PLANNING]));
  });

  test(`${nom} : demande sans circuit Planning -> le Planning n’est pas notifié`, async (t) => {
    const { ids } = await jouer(t, demande('envoyee', { demandeurId: DEMANDEUR_DIRECT, envoyeeALaRh: true }), () => appel(ENTITE, 7, 3, options('rh')));
    assert.deepEqual(ids, [DEMANDEUR_DIRECT]);
  });
}

// ---------------------------------------------------------------------------------------------
// Passage par le Planning
// ---------------------------------------------------------------------------------------------
test('transmettre à la RH : RH + demandeur (date d’envoi pas encore posée), Planning auteur exclu', async (t) => {
  const { ids } = await jouer(t, demande('a_valider_planning'), () => demandeDpaeService.transmettreALaRh(ENTITE, 7, 8, options('planning')));
  assert.deepEqual(trier(ids), trier([INSPECTEUR, ...RH]));
});

test('retransmettre à la RH (depuis En attente) : RH + demandeur, auteur exclu', async (t) => {
  const enAttente = demande('en_attente', { envoyeeALaRh: true });
  const parPlanning = await jouer(t, enAttente, () => demandeDpaeService.retransmettreALaRh(ENTITE, 7, 8, options('planning')));
  assert.deepEqual(trier(parPlanning.ids), trier([INSPECTEUR, ...RH]));
});

test('retransmettre à la RH par l’inspecteur demandeur : seulement la RH', async (t) => {
  const { ids } = await jouer(t, demande('en_attente', { envoyeeALaRh: true }), () => demandeDpaeService.retransmettreALaRh(ENTITE, 7, INSPECTEUR, options('inspecteur_hotellerie')));
  assert.deepEqual(trier(ids), trier(RH));
});

test('renvoyer à l’inspecteur : le demandeur seulement', async (t) => {
  const { ids } = await jouer(t, demande('a_valider_planning'), () => demandeDpaeService.renvoyerAInspecteur(ENTITE, 7, 8, options('planning')));
  assert.deepEqual(ids, [INSPECTEUR]);
});

test('envoyer au Planning : le Planning seulement, l’inspecteur auteur exclu, la RH jamais', async (t) => {
  const { ids } = await jouer(t, demande('renvoyee_inspecteur'), () => demandeDpaeService.envoyerAuPlanning(ENTITE, 7, INSPECTEUR, options('inspecteur_hotellerie')));
  assert.deepEqual(trier(ids), trier(PLANNING));
});

// ---------------------------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------------------------
async function jouerCreation(t, auteurId, roleCode) {
  t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  return jouer(t, demande('envoyee'), () => demandeDpaeService.creerEtEnvoyer(ENTITE, auteurId, { salarieNom: 'Martin', salariePrenom: 'Sophie', sitesAffectationIds: [10] }, { roleCode }));
}

test('création par un inspecteur : le Planning seulement', async (t) => {
  const { ids } = await jouerCreation(t, INSPECTEUR, 'inspecteur_hotellerie');
  assert.deepEqual(trier(ids), trier(PLANNING));
});

test('création par un autre rôle (envoi direct) : la RH seulement', async (t) => {
  const { ids } = await jouerCreation(t, ADMIN, 'admin');
  assert.deepEqual(trier(ids), trier(RH));
});

// ---------------------------------------------------------------------------------------------
// Classement sans suite : toutes les parties
// ---------------------------------------------------------------------------------------------
test('classer sans suite : toutes les parties de la demande (demandeur, Planning, RH), auteur exclu', async (t) => {
  const { ids } = await jouer(t, demande('envoyee', { envoyeeALaRh: true }), () => demandeDpaeService.classerSansSuite(ENTITE, 7, 8, options('planning')));
  assert.deepEqual(trier(ids), trier([INSPECTEUR, 9, ...RH]));
});

test('classer sans suite une demande jamais transmise : la RH n’est pas notifiée', async (t) => {
  const { ids } = await jouer(t, demande('a_valider_planning'), () => demandeDpaeService.classerSansSuite(ENTITE, 7, 8, options('planning')));
  assert.deepEqual(trier(ids), trier([INSPECTEUR, 9]));
});

test('classer sans suite une demande sans circuit Planning : demandeur + RH, pas le Planning', async (t) => {
  const { ids } = await jouer(t, demande('envoyee', { demandeurId: DEMANDEUR_DIRECT, envoyeeALaRh: true }), () => demandeDpaeService.classerSansSuite(ENTITE, 7, ADMIN, options('admin')));
  assert.deepEqual(trier(ids), trier([DEMANDEUR_DIRECT, ...RH]));
});

// ---------------------------------------------------------------------------------------------
// Réactivation : rôle qui reprend la main + demandeur
// ---------------------------------------------------------------------------------------------
test('réactiver : le rôle qui reprend la main + le demandeur', async (t) => {
  const vers = [
    ['inspecteur_hotellerie', 'envoyee', [INSPECTEUR]],
    ['planning', 'envoyee', [INSPECTEUR, ...PLANNING]],
    ['admin', 'envoyee', [INSPECTEUR, ...RH]],
  ];
  for (const [classeePar, statutAvant, attendus] of vers) {
    const { ids } = await jouer(t, demande('classee_sans_suite', { envoyeeALaRh: true, classeeParRole: classeePar, statutAvant }), () => demandeDpaeService.reactiver(ENTITE, 7, ADMIN, options('admin')));
    assert.deepEqual(trier(ids), trier(attendus), classeePar);
  }
});

test('réactiver vers le Planning une demande hors circuit : le Planning reprend la main et est notifié', async (t) => {
  const { ids } = await jouer(t, demande('classee_sans_suite', { demandeurId: DEMANDEUR_DIRECT, classeeParRole: 'planning' }), () => demandeDpaeService.reactiver(ENTITE, 7, ADMIN, options('admin')));
  assert.deepEqual(trier(ids), trier([DEMANDEUR_DIRECT, ...PLANNING]));
});

// ---------------------------------------------------------------------------------------------
// Modification et notes : toutes les parties
// ---------------------------------------------------------------------------------------------
const DONNEES = { typeDemande: 'nouvelle_embauche', salarieNom: 'Martin', salariePrenom: 'Sophie', salarieTelephone: '0612345678', sitesAffectationIds: [10] };
const modifier = (utilisateurId, roleCode, noteModification = 'Téléphone corrigé') =>
  demandeDpaeService.modifierDemande(ENTITE, 7, { donnees: DONNEES, version: VERSION, utilisateurId, roleCode, adresseIp: 'x', noteModification });

test('modification : toutes les parties de la demande, auteur exclu, avec l’extrait de la note', async (t) => {
  const { ids, notifications } = await jouer(t, demande('envoyee', { envoyeeALaRh: true }), () => modifier(8, 'planning'));
  assert.deepEqual(trier(ids), trier([INSPECTEUR, 9, ...RH]));
  assert.match(notifications[0].message, / : demande modifiée par .* \(Planning\) – « Téléphone corrigé »$/);
});

test('modification d’une demande jamais transmise : la RH n’est pas notifiée', async (t) => {
  const { ids } = await jouer(t, demande('a_valider_planning'), () => modifier(INSPECTEUR, 'inspecteur_hotellerie'));
  assert.deepEqual(trier(ids), trier(PLANNING));
});

test('ajout de note : toutes les parties, auteur exclu, 80 premiers caractères de la note', async (t) => {
  const note = `${'x'.repeat(100)}`;
  const { ids, notifications } = await jouer(t, demande('envoyee', { envoyeeALaRh: true }), () =>
    notesDemandeDpaeService.ajouterNote(ENTITE, { demandeId: 7, contenu: note, auteurId: 3, roleCode: 'rh' }),
  );
  assert.deepEqual(trier(ids), trier([INSPECTEUR, ...PLANNING, 4]));
  assert.match(notifications[0].message, /: note ajoutée par Alice DURAND3 \(RH\) – « x{80}… »$/);
});

test('ajout de note sur une demande sans circuit Planning : demandeur + RH, pas le Planning', async (t) => {
  const { ids } = await jouer(t, demande('envoyee', { demandeurId: DEMANDEUR_DIRECT, envoyeeALaRh: true }), () =>
    notesDemandeDpaeService.ajouterNote(ENTITE, { demandeId: 7, contenu: 'Précision', auteurId: ADMIN, roleCode: 'admin' }),
  );
  assert.deepEqual(trier(ids), trier([DEMANDEUR_DIRECT, ...RH]));
});

test('ajout de note sur une demande jamais transmise : la RH n’est pas notifiée', async (t) => {
  const { ids } = await jouer(t, demande('a_valider_planning'), () =>
    notesDemandeDpaeService.ajouterNote(ENTITE, { demandeId: 7, contenu: 'Précision', auteurId: 8, roleCode: 'planning' }),
  );
  assert.deepEqual(trier(ids), trier([INSPECTEUR, 9]));
});

test('aucune action ne produit de doublon', async (t) => {
  const { ids } = await jouer(t, demande('envoyee', { envoyeeALaRh: true }), () =>
    notesDemandeDpaeService.ajouterNote(ENTITE, { demandeId: 7, contenu: 'x', auteurId: ADMIN, roleCode: 'admin' }),
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes(ADMIN), false);
});
