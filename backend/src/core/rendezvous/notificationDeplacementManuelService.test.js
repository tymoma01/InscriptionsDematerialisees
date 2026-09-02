const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
// notificationFactory() dispatche par canal vers l'un de ces deux singletons (sms -> AllMySMS,
// email -> Graph) — même patron que invitationTestService.test.js/
// notificationChangementLieuService.test.js : on mocke `envoyer` directement, jamais
// notificationFactory elle-même.
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const notificationDeplacementManuelService = require('./notificationDeplacementManuelService');

const ENTITE_SMS_ACTIF = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

function mockerKnex(t, { coordonnees = { email: 'sophie.martin@exemple.test' }, formateur = null } = {}) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => coordonnees);
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => formateur);
}

test("envoyerNotificationDeplacementManuel n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  mockerKnex(t);
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_INACTIF, {
    dossierId: 42,
    formateurId: 7,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: false, formateurEmailEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
});

test('envoyerNotificationDeplacementManuel envoie un email candidat ET un email formateur/inspecteur mentionnant l\'ancien ET le nouveau créneau', async (t) => {
  mockerKnex(t, {
    coordonnees: { email: 'sophie.martin@exemple.test' },
    formateur: { id: 7, prenom: 'Marc', nom: 'Dupont', email: 'marc.dupont@exemple.test' },
  });
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    formateurId: 7,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: true, formateurEmailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 2);

  const appelCandidat = mailMock.mock.calls[0];
  assert.equal(appelCandidat.arguments[0], 'sophie.martin@exemple.test');
  assert.equal(appelCandidat.arguments[1], 'email');
  assert.match(appelCandidat.arguments[2], /Sophie Martin/);
  assert.match(appelCandidat.arguments[2], /a été déplacé/);
  assert.equal(appelCandidat.arguments[3].sujet, 'Votre test ACCECIT a été déplacé');
  assert.equal(appelCandidat.arguments[3].html, true);
  // Pas de pièce jointe .ics (voir commentaire d'en-tête du service) — contrairement à
  // invitationTestService.js/notificationChangementLieuService.js.
  assert.equal(appelCandidat.arguments[3].piecesJointes, undefined);

  const appelFormateur = mailMock.mock.calls[1];
  assert.equal(appelFormateur.arguments[0], 'marc.dupont@exemple.test');
  assert.equal(appelFormateur.arguments[1], 'email');
  assert.match(appelFormateur.arguments[2], /Bonjour Marc/);
  assert.match(appelFormateur.arguments[2], /Sophie Martin/);
  assert.equal(appelFormateur.arguments[3].sujet, 'Test déplacé');
  assert.equal(appelFormateur.arguments[3].piecesJointes, undefined);
});

test("envoyerNotificationDeplacementManuel n'envoie que l'email candidat quand aucun formateurId n'est transmis", async (t) => {
  mockerKnex(t);
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: true, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
});

test("envoyerNotificationDeplacementManuel n'envoie rien au candidat si son email n'est pas renseigné, mais notifie quand même le formateur/inspecteur", async (t) => {
  mockerKnex(t, {
    coordonnees: { email: null },
    formateur: { id: 7, prenom: 'Marc', nom: 'Dupont', email: 'marc.dupont@exemple.test' },
  });
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    formateurId: 7,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: false, formateurEmailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'marc.dupont@exemple.test');
});

test("envoyerNotificationDeplacementManuel n'envoie rien au formateur/inspecteur si son email n'est pas renseigné, mais notifie quand même le candidat", async (t) => {
  mockerKnex(t, {
    coordonnees: { email: 'sophie.martin@exemple.test' },
    formateur: { id: 7, prenom: 'Marc', nom: 'Dupont', email: null },
  });
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    formateurId: 7,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: true, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'sophie.martin@exemple.test');
});

test("envoyerNotificationDeplacementManuel renvoie emailEnvoye: false pour un canal si son envoi échoue, sans lever d'erreur ni empêcher l'autre canal", async (t) => {
  mockerKnex(t, {
    coordonnees: { email: 'sophie.martin@exemple.test' },
    formateur: { id: 7, prenom: 'Marc', nom: 'Dupont', email: 'marc.dupont@exemple.test' },
  });
  t.mock.method(graphMailProvider, 'envoyer', async (destinataire) => {
    if (destinataire === 'sophie.martin@exemple.test') throw new Error('Panne réseau simulée');
  });

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    formateurId: 7,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: false, formateurEmailEnvoye: true });
});
