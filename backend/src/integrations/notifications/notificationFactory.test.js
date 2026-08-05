const test = require('node:test');
const assert = require('node:assert/strict');

// Vérifie uniquement le dispatch par canal (email -> graphMailProvider, sms -> allMySmsProvider) :
// c'est la seule logique propre à ce fichier, chaque provider ayant ses propres tests dédiés
// (graphMailProvider.test.js, pas d'équivalent AllMySMS à ce jour). Mock des deux providers
// directement (pas du client Graph/HTTP sous-jacent) — notificationFactory ne doit connaître que
// l'interface NotificationProvider commune, jamais les détails d'un prestataire particulier.
function chargerFactoryAvecProvidersMockes(t) {
  delete require.cache[require.resolve('./notificationFactory')];
  delete require.cache[require.resolve('./graphMailProvider')];
  delete require.cache[require.resolve('./allMySmsProvider')];
  const graphMailProvider = require('./graphMailProvider');
  const allMySmsProvider = require('./allMySmsProvider');
  t.mock.method(graphMailProvider, 'envoyer', async () => {});
  t.mock.method(allMySmsProvider, 'envoyer', async () => {});
  return { notificationFactory: require('./notificationFactory'), graphMailProvider, allMySmsProvider };
}

test("le canal 'email' est envoyé via graphMailProvider, jamais allMySmsProvider", async (t) => {
  const { notificationFactory, graphMailProvider, allMySmsProvider } = chargerFactoryAvecProvidersMockes(t);

  await notificationFactory().envoyer('candidat@exemple.test', 'email', 'Contenu', { sujet: 'Sujet' });

  assert.equal(graphMailProvider.envoyer.mock.callCount(), 1);
  assert.deepEqual(graphMailProvider.envoyer.mock.calls[0].arguments, [
    'candidat@exemple.test',
    'email',
    'Contenu',
    { sujet: 'Sujet' },
  ]);
  assert.equal(allMySmsProvider.envoyer.mock.callCount(), 0);
});

test("le canal 'sms' est envoyé via allMySmsProvider, jamais graphMailProvider", async (t) => {
  const { notificationFactory, graphMailProvider, allMySmsProvider } = chargerFactoryAvecProvidersMockes(t);

  await notificationFactory().envoyer('0600000000', 'sms', 'Contenu');

  assert.equal(allMySmsProvider.envoyer.mock.callCount(), 1);
  assert.deepEqual(allMySmsProvider.envoyer.mock.calls[0].arguments, ['0600000000', 'sms', 'Contenu', {}]);
  assert.equal(graphMailProvider.envoyer.mock.callCount(), 0);
});

// Reproduit le patron réel des appelants (invitationTestService.js) : une seule instance de
// notificationFactory() réutilisée pour successivement envoyer un email puis un SMS — le dispatch
// doit se refaire à chaque appel de `.envoyer(...)`, pas être figé au moment de `notificationFactory()`.
test('une même instance dispatche correctement deux canaux différents successivement', async (t) => {
  const { notificationFactory, graphMailProvider, allMySmsProvider } = chargerFactoryAvecProvidersMockes(t);
  const notificationProvider = notificationFactory();

  await notificationProvider.envoyer('candidat@exemple.test', 'email', 'Contenu email');
  await notificationProvider.envoyer('0600000000', 'sms', 'Contenu sms');

  assert.equal(graphMailProvider.envoyer.mock.callCount(), 1);
  assert.equal(allMySmsProvider.envoyer.mock.callCount(), 1);
});
