const test = require('node:test');
const assert = require('node:assert/strict');

// Même patron de mock que invitationTestService.test.js : notificationFactory() dispatche par
// canal vers l'un de ces deux singletons (sms -> AllMySMS, email -> Graph) — on mocke la méthode
// `envoyer` de chacun directement, jamais notificationFactory elle-même (export de fonction brute,
// non mockable une fois consommé).
const allMySmsProvider = require('../../integrations/notifications/allMySmsProvider');
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const notificationChangementLieuService = require('./notificationChangementLieuService');

// RFC 5545 replie toute ligne dépassant 75 octets sur une ligne suivante commençant par une
// espace/tabulation (voir generateurIcs.test.js) — sans ce dépliage, un .includes() sur une ligne
// longue (LOCATION avec metroAcces, voir plus bas) pourrait couper au milieu du texte attendu.
function deplierIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

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

// Objet structuré depuis la migration 047 (remplace l'ancien libelle string unique, voir audit du
// 2026-08-13) — troisième argument de envoyerNotificationChangementLieu.
const NOUVEAU_LIEU = { adresse: 'Salle Annexe - 3 rue des Tests, 75001 Paris' };

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
    NOUVEAU_LIEU,
  );

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: false, formateurEmailEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
  assert.equal(smsMock.mock.calls.length, 0);
});

test('envoyerNotificationChangementLieu envoie un email et un SMS mentionnant la nouvelle adresse', async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    RENDEZVOUS,
    NOUVEAU_LIEU,
  );

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: true, formateurEmailEnvoye: false });
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

test("envoyerNotificationChangementLieu limite le SMS/.ics à adresse+metroAcces, et n'inclut les instructions que dans l'email HTML", async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const nouveauLieuAvecAcces = {
    adresse: 'Salle Annexe - 3 rue des Tests, 75001 Paris',
    metroAcces: 'Métro Corentin Celton',
    instructions: 'Sonnez à « Annexe ACCECIT ».',
  };
  await notificationChangementLieuService.envoyerNotificationChangementLieu(ENTITE_SMS_ACTIF, RENDEZVOUS, nouveauLieuAvecAcces);

  const appelSms = smsMock.mock.calls[0];
  assert.ok(appelSms.arguments[2].includes('Salle Annexe - 3 rue des Tests, 75001 Paris (Métro Corentin Celton)'));
  assert.ok(!appelSms.arguments[2].includes('Annexe ACCECIT'));

  const contenuIcs = deplierIcs(mailMock.mock.calls[0].arguments[3].piecesJointes[0].contenu.toString('utf8'));
  assert.ok(contenuIcs.includes('Corentin Celton'));
  assert.ok(!contenuIcs.includes('Annexe ACCECIT'));

  const corpsEmail = mailMock.mock.calls[0].arguments[2];
  assert.ok(corpsEmail.includes('Métro Corentin Celton'));
  assert.ok(corpsEmail.includes('Sonnez à'));
});

test("envoyerNotificationChangementLieu inclut les instructions dans l'email candidat mais PAS dans l'email formateur (consignes d'accueil sans objet pour le personnel)", async (t) => {
  const { mailMock } = mockerProviders(t);

  const rendezvousAvecFormateur = {
    ...RENDEZVOUS,
    formateur_nom: 'Dupont',
    formateur_prenom: 'Marc',
    formateur_email: 'marc.dupont@exemple.test',
  };
  const nouveauLieuAvecAcces = {
    adresse: 'Salle Annexe - 3 rue des Tests, 75001 Paris',
    metroAcces: 'Métro Corentin Celton',
    instructions: 'Sonnez à « Annexe ACCECIT ».',
  };
  await notificationChangementLieuService.envoyerNotificationChangementLieu(ENTITE_SMS_ACTIF, rendezvousAvecFormateur, nouveauLieuAvecAcces);

  const corpsCandidat = mailMock.mock.calls[0].arguments[2];
  assert.ok(corpsCandidat.includes('Métro Corentin Celton'));
  assert.ok(corpsCandidat.includes('Sonnez à'));

  const corpsFormateur = mailMock.mock.calls[1].arguments[2];
  assert.ok(corpsFormateur.includes('Métro Corentin Celton'));
  assert.ok(!corpsFormateur.includes('Sonnez'));
  assert.ok(!corpsFormateur.includes('Annexe ACCECIT'));
});

test("envoyerNotificationChangementLieu inclut le formateur déjà assigné comme participant de l'.ics et lui envoie sa propre notification, comme la convocation initiale", async (t) => {
  const { mailMock } = mockerProviders(t);

  const rendezvousAvecFormateur = {
    ...RENDEZVOUS,
    formateur_nom: 'Dupont',
    formateur_prenom: 'Marc',
    formateur_email: 'marc.dupont@exemple.test',
  };
  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    rendezvousAvecFormateur,
    NOUVEAU_LIEU,
  );

  assert.equal(resultat.formateurEmailEnvoye, true);
  assert.equal(mailMock.mock.calls.length, 2);

  const contenuIcs = mailMock.mock.calls[0].arguments[3].piecesJointes[0].contenu.toString('utf8');
  assert.ok(contenuIcs.includes('marc.dupont@exemple.test'));

  const appelFormateur = mailMock.mock.calls[1];
  assert.equal(appelFormateur.arguments[0], 'marc.dupont@exemple.test');
  assert.equal(appelFormateur.arguments[3].sujet, 'Changement de lieu pour un test à évaluer');
  assert.ok(appelFormateur.arguments[2].includes('Bonjour Marc'));
  assert.ok(appelFormateur.arguments[2].includes('Salle Annexe - 3 rue des Tests, 75001 Paris'));
});

test("envoyerNotificationChangementLieu ignore la notification formateur quand le formateur assigné n'a pas d'email renseigné", async (t) => {
  const { mailMock } = mockerProviders(t);

  const rendezvousFormateurSansEmail = {
    ...RENDEZVOUS,
    formateur_nom: 'Dupont',
    formateur_prenom: 'Marc',
    formateur_email: null,
  };
  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    rendezvousFormateurSansEmail,
    NOUVEAU_LIEU,
  );

  assert.equal(resultat.formateurEmailEnvoye, false);
  assert.equal(mailMock.mock.calls.length, 1);
});

test("envoyerNotificationChangementLieu n'échoue pas si l'envoi de l'email formateur échoue", async (t) => {
  const rendezvousAvecFormateur = {
    ...RENDEZVOUS,
    formateur_nom: 'Dupont',
    formateur_prenom: 'Marc',
    formateur_email: 'marc.dupont@exemple.test',
  };
  let appels = 0;
  mockerProviders(t, {
    email: async (destinataire) => {
      appels += 1;
      if (destinataire === 'marc.dupont@exemple.test') {
        throw new Error('Microsoft Graph indisponible');
      }
    },
  });

  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    rendezvousAvecFormateur,
    NOUVEAU_LIEU,
  );

  assert.equal(resultat.emailEnvoye, true);
  assert.equal(resultat.formateurEmailEnvoye, false);
  assert.equal(appels, 2);
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
    NOUVEAU_LIEU,
  );

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: false });
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
    NOUVEAU_LIEU,
  );

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: true, formateurEmailEnvoye: false });
});

test('envoyerNotificationChangementLieu ignore un canal sans coordonnée sans faire échouer ni planter', async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const rendezvousSansTelephone = { ...RENDEZVOUS, donnees_coordonnees: { email: 'sophie.martin@exemple.test', telephone: null } };
  const resultat = await notificationChangementLieuService.envoyerNotificationChangementLieu(
    ENTITE_SMS_ACTIF,
    rendezvousSansTelephone,
    NOUVEAU_LIEU,
  );

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(smsMock.mock.calls.length, 0);
});
