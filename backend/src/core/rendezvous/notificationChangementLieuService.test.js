const test = require('node:test');
const assert = require('node:assert/strict');

// Même patron de mock que invitationTestService.test.js : notificationFactory() dispatche par
// canal vers l'un de ces deux singletons (sms -> AllMySMS, email -> Graph) — on mocke la méthode
// `envoyer` de chacun directement, jamais notificationFactory elle-même (export de fonction brute,
// non mockable une fois consommé).
const allMySmsProvider = require('../../integrations/notifications/allMySmsProvider');
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const notificationChangementLieuService = require('./notificationChangementLieuService');

const ENTITE_SMS_ACTIF = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

const RENDEZVOUS = {
  id: 55,
  dossier_id: 42,
  date_heure: '2099-01-01T10:00:00.000Z',
  candidat_nom: 'Martin',
  candidat_prenom: 'Sophie',
  donnees_coordonnees: { email: 'sophie.martin@exemple.test', telephone: '0601020304' },
};

function mockerProviders(t, { email = async () => {}, sms = async () => {} } = {}) {
  return {
    mailMock: t.mock.method(graphMailProvider, 'envoyer', email),
    smsMock: t.mock.method(allMySmsProvider, 'envoyer', sms),
  };
}

test("envoyerNotificationChangementLieu n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_INACTIF,
    RENDEZVOUS,
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  );

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
  assert.equal(smsMock.mock.calls.length, 0);
});

test('envoyerNotificationChangementLieu envoie un email et un SMS mentionnant la nouvelle adresse', async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    RENDEZVOUS,
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  );

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(smsMock.mock.calls.length, 1);

  const appelEmail = mailMock.mock.calls[0];
  assert.equal(appelEmail.arguments[0], 'sophie.martin@exemple.test');
  const { sujet, piecesJointes } = appelEmail.arguments[3];
  assert.equal(sujet, 'Changement de lieu pour votre test ACCECIT');
  const corpsEmail = appelEmail.arguments[2];
  assert.ok(corpsEmail.includes('Bonjour Sophie Martin'));
  assert.ok(corpsEmail.includes('Salle Annexe - 3 rue des Tests, 75001 Paris'));

  const appelSms = smsMock.mock.calls[0];
  assert.equal(appelSms.arguments[0], '0601020304');
  assert.ok(appelSms.arguments[2].includes('Salle Annexe - 3 rue des Tests, 75001 Paris'));

  // Bug corrigé : l'email de changement de lieu doit joindre le .ics, comme la convocation
  // initiale (invitationTestService.js) — voir generateurIcs.js pour la génération partagée.
  assert.equal(piecesJointes.length, 1);
  assert.equal(piecesJointes[0].nom, 'convocation-test-accecit.ics');
  assert.equal(piecesJointes[0].typeMime, 'text/calendar');
  const contenuIcs = piecesJointes[0].contenu.toString('utf8');
  assert.ok(contenuIcs.includes('BEGIN:VCALENDAR'));
  assert.ok(contenuIcs.includes('LOCATION:Salle Annexe - 3 rue des Tests\\, 75001 Paris'));
  // Date/heure du rendez-vous INCHANGÉE (seul le lieu change) — 10:00 UTC = 2099-01-01T10:00:00Z.
  assert.ok(contenuIcs.includes('DTSTART:20990101T100000Z'));
  // UID identique à celui que produirait invitationTestService.js pour ce même rendez-vous
  // (rendezvous.id = 55, voir RENDEZVOUS plus haut) : un client calendrier doit reconnaître une
  // mise à jour du même événement, pas un second événement en doublon. SEQUENCE:1 (>0) confirme
  // qu'il s'agit bien d'une révision, pas de la version initiale.
  assert.ok(contenuIcs.includes('UID:rendezvous-55@accecit.com'));
  assert.ok(contenuIcs.includes('SEQUENCE:1'));
});

test("envoyerNotificationChangementLieu inclut le formateur déjà assigné comme participant de l'.ics, comme la convocation initiale", async (t) => {
  const { mailMock } = mockerProviders(t);

  const rendezvousAvecFormateur = {
    ...RENDEZVOUS,
    formateur_nom: 'Dupont',
    formateur_prenom: 'Marc',
    formateur_email: 'marc.dupont@exemple.test',
  };
  await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    rendezvousAvecFormateur,
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  );

  const contenuIcs = mailMock.mock.calls[0].arguments[3].piecesJointes[0].contenu.toString('utf8');
  assert.ok(contenuIcs.includes('marc.dupont@exemple.test'));
});

// Exigence explicite : les identifiants AllMySMS ne sont pas encore configurés dans ce projet —
// un échec SMS (faute de config ou autre) ne doit jamais empêcher l'email ni remonter comme une
// erreur à l'appelant (lieuService.supprimerLieu, déjà tout acté en base à ce stade).
test("envoyerNotificationChangementLieu n'échoue pas et envoie quand même l'email si le SMS échoue", async (t) => {
  mockerProviders(t, {
    sms: async () => {
      throw new Error('Identifiants AllMySMS non configurés');
    },
  });

  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    RENDEZVOUS,
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  );

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false });
});

test("envoyerNotificationChangementLieu tente quand même le SMS si l'email échoue", async (t) => {
  mockerProviders(t, {
    email: async () => {
      throw new Error('Microsoft Graph indisponible');
    },
  });

  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    RENDEZVOUS,
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  );

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: true });
});

test('envoyerNotificationChangementLieu ignore un canal sans coordonnée sans faire échouer ni planter', async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const rendezvousSansTelephone = { ...RENDEZVOUS, donnees_coordonnees: { email: 'sophie.martin@exemple.test', telephone: null } };
  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    rendezvousSansTelephone,
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  );

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(smsMock.mock.calls.length, 0);
});
