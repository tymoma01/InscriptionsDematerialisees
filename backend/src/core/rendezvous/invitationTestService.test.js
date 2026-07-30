const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
// notificationFactory() retourne toujours ce même singleton : on mocke ses méthodes directement
// plutôt que notificationFactory (export de fonction brute, non mockable via t.mock.method une
// fois consommé — même raison que pour storageFactory, voir azureOneDriveConnector.test.js).
const allMySmsProvider = require('../../integrations/notifications/allMySmsProvider');
const invitationTestService = require('./invitationTestService');

const ENTITE_SMS_ACTIF = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

const RENDEZVOUS = { id: 55, dossier_id: 42, date_heure: '2099-01-01T10:00:00.000Z' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
}

test("envoyerInvitationTest n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  const envoyerMock = t.mock.method(allMySmsProvider, 'envoyer', async () => {});

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_INACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: false, desactive: true });
  assert.equal(envoyerMock.mock.calls.length, 0);
});

test('envoyerInvitationTest envoie un email avec .ics joint et un SMS quand email et téléphone sont connus', async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  const envoyerMock = t.mock.method(allMySmsProvider, 'envoyer', async () => {});

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: true });
  assert.equal(envoyerMock.mock.calls.length, 2);

  const appelEmail = envoyerMock.mock.calls.find((appel) => appel.arguments[1] === 'email');
  assert.equal(appelEmail.arguments[0], 'sophie.martin@exemple.test');
  const { piecesJointes, sujet } = appelEmail.arguments[3];
  assert.equal(sujet, 'Convocation à votre test ACCECIT');
  assert.equal(piecesJointes[0].typeMime, 'text/calendar');
  assert.ok(piecesJointes[0].contenu.toString('utf8').includes('BEGIN:VCALENDAR'));

  const appelSms = envoyerMock.mock.calls.find((appel) => appel.arguments[1] === 'sms');
  assert.equal(appelSms.arguments[0], '0601020304');
});

test("envoyerInvitationTest ignore un canal sans coordonnée sans faire échouer l'autre", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  const envoyerMock = t.mock.method(allMySmsProvider, 'envoyer', async () => {});

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false });
  assert.equal(envoyerMock.mock.calls.length, 1);
});

test("envoyerInvitationTest tente quand même le sms si l'envoi de l'email échoue", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  t.mock.method(allMySmsProvider, 'envoyer', async (destinataire, canal) => {
    if (canal === 'email') throw new Error('AllMySMS indisponible');
  });

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: true });
});
