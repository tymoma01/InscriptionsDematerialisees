const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
// notificationFactory() dispatche par canal vers l'un de ces deux singletons (sms -> AllMySMS,
// email -> Graph) — même patron que invitationTestService.test.js/
// notificationChangementLieuService.test.js : on mocke `envoyer` directement, jamais
// notificationFactory elle-même.
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const notificationDeplacementManuelService = require('./notificationDeplacementManuelService');

const ENTITE_SMS_ACTIF = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

function mockerKnex(t, { coordonnees = { email: 'sophie.martin@exemple.test' } } = {}) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => coordonnees);
}

test("envoyerNotificationDeplacementManuel n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  mockerKnex(t);
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_INACTIF, {
    dossierId: 42,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { emailEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
});

test('envoyerNotificationDeplacementManuel envoie un email candidat mentionnant l\'ancien ET le nouveau créneau', async (t) => {
  mockerKnex(t);
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { emailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 1);

  const appel = mailMock.mock.calls[0];
  assert.equal(appel.arguments[0], 'sophie.martin@exemple.test');
  assert.equal(appel.arguments[1], 'email');
  assert.match(appel.arguments[2], /Sophie Martin/);
  assert.match(appel.arguments[2], /a été déplacé/);
  assert.equal(appel.arguments[3].sujet, 'Votre test ACCECIT a été déplacé');
  assert.equal(appel.arguments[3].html, true);
  // Pas de pièce jointe .ics (voir commentaire d'en-tête du service) — contrairement à
  // invitationTestService.js/notificationChangementLieuService.js.
  assert.equal(appel.arguments[3].piecesJointes, undefined);
});

test("envoyerNotificationDeplacementManuel n'envoie rien si le candidat n'a pas d'email renseigné", async (t) => {
  mockerKnex(t, { coordonnees: { email: null } });
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { emailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 0);
});

test("envoyerNotificationDeplacementManuel renvoie emailEnvoye: false si l'envoi échoue, sans lever d'erreur", async (t) => {
  mockerKnex(t);
  t.mock.method(graphMailProvider, 'envoyer', async () => {
    throw new Error('Panne réseau simulée');
  });

  const resultat = await notificationDeplacementManuelService.envoyerNotificationDeplacementManuel(ENTITE_SMS_ACTIF, {
    dossierId: 42,
    ancienneDateHeure: '2026-09-01T10:00:00.000Z',
    nouvelleDateHeure: '2026-09-02T14:30:00.000Z',
  });

  assert.deepEqual(resultat, { emailEnvoye: false });
});
