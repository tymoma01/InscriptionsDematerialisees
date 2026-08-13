const test = require('node:test');
const assert = require('node:assert/strict');

const CHEMIN_SEND_MAIL = '/users/inscriptions@accecit.com/sendMail';

// Même forme de faux client Graph que azureOneDriveConnector.test.js (imite un GraphError :
// statusCode + code) — reconstruit ici plutôt que partagée, ces deux fichiers de test n'ayant pas
// de module utilitaire commun à ce jour (voir CLAUDE.md conventions du projet : dupliqué plutôt
// que factorisé pour ce volume).
function creerClientMock(reponses) {
  return {
    api(chemin) {
      const executer = (methode, corps) => {
        const gestion = reponses[`${methode} ${chemin}`];
        if (!gestion) {
          throw new Error(`Appel Graph non simulé dans ce test : ${methode} ${chemin}`);
        }
        if (gestion.erreur) {
          const erreur = new Error(gestion.erreur.message || 'erreur Graph simulée');
          erreur.statusCode = gestion.erreur.statusCode;
          erreur.code = gestion.erreur.code;
          throw erreur;
        }
        if (gestion.capture) {
          gestion.capture(corps);
        }
        return gestion.valeur;
      };

      return {
        get: async () => executer('GET'),
        put: async (corps) => executer('PUT', corps),
        post: async (corps) => executer('POST', corps),
        delete: async () => executer('DELETE'),
      };
    },
  };
}

// Recharge graphMailProvider/graphClient à l'état initial et mocke obtenirClientGraph — même
// pattern que chargerConnecteurAvecClient dans azureOneDriveConnector.test.js. graphMailProvider
// importe `../stockage/graphClient` (module partagé avec le connecteur de stockage, même app
// registration) : il faut vider son cache lui aussi, sous la clé résolue depuis ce fichier-ci.
function chargerProviderAvecClient(t, clientMock) {
  delete require.cache[require.resolve('./graphMailProvider')];
  delete require.cache[require.resolve('../stockage/graphClient')];
  const graphClient = require('../stockage/graphClient');
  t.mock.method(graphClient, 'obtenirClientGraph', async () => clientMock);
  return require('./graphMailProvider');
}

test("envoyer rejette un canal différent de 'email'", async (t) => {
  const provider = chargerProviderAvecClient(t, creerClientMock({}));

  await assert.rejects(() => provider.envoyer('06000000', 'sms', 'message'), /ne gère que le canal 'email'/);
});

test('envoyer construit un message Graph correct (sujet, corps texte, destinataire) sans pièce jointe', async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: {
      valeur: undefined,
      capture: (corps) => {
        corpsEnvoye = corps;
      },
    },
  });
  const provider = chargerProviderAvecClient(t, client);

  await provider.envoyer('candidat@exemple.test', 'email', 'Bonjour,\n\nÀ bientôt.', { sujet: 'Confirmation' });

  assert.deepEqual(corpsEnvoye, {
    message: {
      subject: 'Confirmation',
      body: { contentType: 'Text', content: 'Bonjour,\n\nÀ bientôt.' },
      toRecipients: [{ emailAddress: { address: 'candidat@exemple.test' } }],
    },
    saveToSentItems: true,
  });
});

// options.html (voir invitationTestService.js/notificationChangementLieuService.js, mise en forme
// avec retours à la ligne) : contentType doit basculer sur 'HTML', jamais rester 'Text' sinon les
// <br>/<p> du corps s'afficheraient littéralement chez le destinataire plutôt que d'être rendus.
test("envoyer avec options.html à true bascule contentType sur 'HTML'", async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { valeur: undefined, capture: (corps) => (corpsEnvoye = corps) },
  });
  const provider = chargerProviderAvecClient(t, client);

  await provider.envoyer('candidat@exemple.test', 'email', '<p>Bonjour,</p><p>À bientôt.</p>', {
    sujet: 'Convocation',
    html: true,
  });

  assert.equal(corpsEnvoye.message.body.contentType, 'HTML');
  assert.equal(corpsEnvoye.message.body.content, '<p>Bonjour,</p><p>À bientôt.</p>');
});

test('envoyer sans options.html reste en contentType Text (comportement historique rappelService.js/relanceService.js)', async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { valeur: undefined, capture: (corps) => (corpsEnvoye = corps) },
  });
  const provider = chargerProviderAvecClient(t, client);

  await provider.envoyer('candidat@exemple.test', 'email', 'Contenu.');

  assert.equal(corpsEnvoye.message.body.contentType, 'Text');
});

test('envoyer sans sujet fourni envoie une chaîne vide plutôt que undefined', async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { valeur: undefined, capture: (corps) => (corpsEnvoye = corps) },
  });
  const provider = chargerProviderAvecClient(t, client);

  await provider.envoyer('candidat@exemple.test', 'email', 'Contenu.');

  assert.equal(corpsEnvoye.message.subject, '');
});

// Cas convocation de test (voir invitationTestService.js) : le .ics généré par generateurIcs.js
// est transmis en pièce jointe, encodé en base64, avec son type MIME text/calendar.
test('envoyer joint les pièces jointes au format fileAttachment Graph (base64)', async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { valeur: undefined, capture: (corps) => (corpsEnvoye = corps) },
  });
  const provider = chargerProviderAvecClient(t, client);

  const contenuIcs = Buffer.from('BEGIN:VCALENDAR\nEND:VCALENDAR', 'utf8');
  await provider.envoyer('candidat@exemple.test', 'email', 'Votre convocation.', {
    sujet: 'Convocation à votre test ACCECIT',
    piecesJointes: [{ nom: 'convocation-test-accecit.ics', contenu: contenuIcs, typeMime: 'text/calendar' }],
  });

  assert.deepEqual(corpsEnvoye.message.attachments, [
    {
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'convocation-test-accecit.ics',
      contentType: 'text/calendar',
      contentBytes: contenuIcs.toString('base64'),
    },
  ]);
});

test("envoyer sans pièce jointe n'ajoute pas la clé attachments", async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { valeur: undefined, capture: (corps) => (corpsEnvoye = corps) },
  });
  const provider = chargerProviderAvecClient(t, client);

  await provider.envoyer('candidat@exemple.test', 'email', 'Contenu.');

  assert.equal('attachments' in corpsEnvoye.message, false);
});

test('envoyer traduit une erreur 401 (token expiré/invalide) en message clair', async (t) => {
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { erreur: { statusCode: 401, code: 'InvalidAuthenticationToken' } },
  });
  const provider = chargerProviderAvecClient(t, client);

  await assert.rejects(
    () => provider.envoyer('candidat@exemple.test', 'email', 'Contenu.'),
    /Authentification Microsoft Graph expirée ou invalide/,
  );
});

// ErrorAccessDenied : code observé sur /users/{id}/sendMail, distinct d'AccessDenied/Forbidden
// utilisé côté API fichiers (voir erreursGraph.js) — et le message doit citer "Mail.Send", pas
// "Files.ReadWrite.All" (permission vérifiée par azureOneDriveConnector.js, sans rapport ici).
test('envoyer traduit une erreur 403 ErrorAccessDenied en citant la permission Mail.Send', async (t) => {
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { erreur: { statusCode: 403, code: 'ErrorAccessDenied' } },
  });
  const provider = chargerProviderAvecClient(t, client);

  await assert.rejects(
    () => provider.envoyer('candidat@exemple.test', 'email', 'Contenu.'),
    /Permissions Microsoft Graph insuffisantes.*"Mail\.Send"/s,
  );
});

test('envoyer traduit une erreur 429 (limite de débit) en message clair', async (t) => {
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { erreur: { statusCode: 429 } },
  });
  const provider = chargerProviderAvecClient(t, client);

  await assert.rejects(
    () => provider.envoyer('candidat@exemple.test', 'email', 'Contenu.'),
    /Limite de débit Microsoft Graph atteinte/,
  );
});
