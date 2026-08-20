const test = require('node:test');
const assert = require('node:assert/strict');

const CHEMIN_SEND_MAIL = '/users/inscriptions@accecit.com/sendMail';

// Même forme de faux client Graph que graphMailProvider.test.js (dupliqué plutôt que factorisé,
// même logique que ce fichier-là). On mocke au niveau du client Graph, pas de notificationFactory,
// pour vérifier le chemin complet notifierEchecSauvegarde -> notificationFactory -> graphMailProvider
// -> Graph, y compris le contenu réel du message envoyé (destinataire, sujet, corps).
function creerClientMock(reponses) {
  return {
    api(chemin) {
      const executer = (methode, corps) => {
        const gestion = reponses[`${methode} ${chemin}`];
        if (!gestion) {
          throw new Error(`Appel Graph non simulé dans ce test : ${methode} ${chemin}`);
        }
        if (gestion.capture) {
          gestion.capture(corps);
        }
        return gestion.valeur;
      };

      return {
        post: async (corps) => executer('POST', corps),
      };
    },
  };
}

// Recharge notifierEchecSauvegarde et sa chaîne de dépendances (notificationFactory,
// graphMailProvider, graphClient) à l'état initial pour chaque test. Ne touche jamais à
// process.env/dotenv (un SAUVEGARDE_EMAIL_ALERTE exporté dans le shell local polluerait
// silencieusement les tests, l'échec d'envoi étant avalé par notifierEchecSauvegarde) : on mute
// directement la propriété sur le singleton env.js déjà chargé, lu par référence à chaque appel.
function chargerNotificationAvecClient(t, clientMock, { emailAlerte } = {}) {
  for (const cheminModule of [
    './notificationEchecSauvegarde',
    '../../integrations/notifications/notificationFactory',
    '../../integrations/notifications/graphMailProvider',
    '../../integrations/stockage/graphClient',
  ]) {
    delete require.cache[require.resolve(cheminModule)];
  }

  const env = require('../../config/env');
  env.SAUVEGARDE_EMAIL_ALERTE = emailAlerte;

  const graphClient = require('../../integrations/stockage/graphClient');
  t.mock.method(graphClient, 'obtenirClientGraph', async () => clientMock);

  return { ...require('./notificationEchecSauvegarde'), graphClient };
}

test("notifierEchecSauvegarde : envoie bien un email d'alerte via Microsoft Graph quand SAUVEGARDE_EMAIL_ALERTE est configuré", async (t) => {
  let corpsEnvoye;
  const client = creerClientMock({
    [`POST ${CHEMIN_SEND_MAIL}`]: { valeur: undefined, capture: (corps) => (corpsEnvoye = corps) },
  });
  const { notifierEchecSauvegarde } = chargerNotificationAvecClient(t, client, {
    emailAlerte: 'coordination@accecit.test',
  });

  await notifierEchecSauvegarde(new Error('pg_dump a échoué (code 1)'));

  assert.ok(corpsEnvoye, "l'email d'alerte aurait dû être envoyé via Graph");
  assert.equal(corpsEnvoye.message.toRecipients[0].emailAddress.address, 'coordination@accecit.test');
  assert.equal(corpsEnvoye.message.subject, '[ACCECIT] Échec de la sauvegarde quotidienne Neon');
  assert.match(corpsEnvoye.message.body.content, /pg_dump a échoué \(code 1\)/);
});

test("notifierEchecSauvegarde : n'appelle jamais Graph quand SAUVEGARDE_EMAIL_ALERTE n'est pas configuré", async (t) => {
  const { notifierEchecSauvegarde, graphClient } = chargerNotificationAvecClient(t, creerClientMock({}), {
    emailAlerte: undefined,
  });

  await notifierEchecSauvegarde(new Error('pg_dump a échoué (code 1)'));

  assert.equal(graphClient.obtenirClientGraph.mock.callCount(), 0);
});

test('notifierEchecSauvegarde : une erreur Graph (ex. token expiré) est absorbée, jamais relancée', async (t) => {
  // Client Graph qui échoue systématiquement, pour vérifier que l'appelant (sauvegardeService.js,
  // qui a déjà levé sa propre erreur) n'en reçoit jamais une seconde depuis la notification elle-même.
  const client = {
    api: () => ({
      post: async () => {
        const erreur = new Error('erreur Graph simulée');
        erreur.statusCode = 401;
        erreur.code = 'InvalidAuthenticationToken';
        throw erreur;
      },
    }),
  };
  const { notifierEchecSauvegarde } = chargerNotificationAvecClient(t, client, {
    emailAlerte: 'coordination@accecit.test',
  });

  await assert.doesNotReject(() => notifierEchecSauvegarde(new Error('pg_dump a échoué (code 1)')));
});
