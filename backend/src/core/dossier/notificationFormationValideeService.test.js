const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
// notificationFactory() dispatche vers ce singleton pour le canal 'email' (voir
// notificationFactory.js) — mocké directement, même raison/patron que
// invitationTestService.test.js (t.mock.method sur le provider, jamais sur la factory elle-même).
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const {
  envoyerEmailFormationValidee,
  construireMessageEmailFormationValidee,
} = require('./notificationFormationValideeService');

const ENTITE_SMS_ACTIF = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({ candidat_prenom: 'Sophie' }));
}

// Texte DÉFINITIF (décision utilisateur 2026-08-31, pas un brouillon) — ce test verrouille le
// sujet et le corps exacts fournis, pour qu'une modification future soit délibérée (test qui
// échoue) plutôt que silencieuse.
test('construireMessageEmailFormationValidee produit le sujet et le corps exacts définis', () => {
  const { sujet, corps } = construireMessageEmailFormationValidee('Sophie');

  assert.equal(sujet, 'Formation Accecit validée – prochaine étape');
  assert.equal(
    corps,
    '<p>Bonjour Sophie,</p>' +
      '<p>Nous avons le plaisir de vous informer que votre formation a été validée.</p>' +
      '<p>Accecit reviendra vers vous dans les prochains jours pour poursuivre le processus de recrutement.</p>' +
      "<p>D'ici là, nous vous remercions de bien vouloir rester disponible pendant une semaine à compter de la " +
      'réception de ce mail. Le délai de recrutement peut en effet prendre un peu de temps, et nous souhaitons ' +
      'pouvoir vous solliciter rapidement si une opportunité se présente pour rejoindre nos équipes.</p>' +
      "<p>N'hésitez pas à revenir vers nous si vous avez la moindre question.</p>" +
      "<p>À bientôt,<br>\nL'équipe ACCECIT<br>\n01 56 56 69 56<br>\n47 avenue Paul Vaillant Couturier, 94250 Gentilly</p>",
  );
});

test('construireMessageEmailFormationValidee échappe le prénom (valeur potentiellement saisie par le candidat)', () => {
  const { corps } = construireMessageEmailFormationValidee('<script>Sophie</script>');
  assert.ok(corps.includes('&lt;script&gt;Sophie&lt;/script&gt;'));
  assert.ok(!corps.includes('<script>Sophie</script>'));
});

test("envoyerEmailFormationValidee n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await envoyerEmailFormationValidee(ENTITE_SMS_INACTIF, 69);

  assert.deepEqual(resultat, { emailEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
});

test("envoyerEmailFormationValidee envoie l'email au CANDIDAT (pas au formateur) avec le sujet exact", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: 'sophie.martin@exemple.test' }));
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await envoyerEmailFormationValidee(ENTITE_SMS_ACTIF, 69);

  assert.deepEqual(resultat, { emailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 1);
  const appel = mailMock.mock.calls[0];
  assert.equal(appel.arguments[0], 'sophie.martin@exemple.test');
  assert.equal(appel.arguments[1], 'email');
  const options = appel.arguments[3];
  assert.equal(options.sujet, 'Formation Accecit validée – prochaine étape');
  assert.equal(options.html, true);
});

test("envoyerEmailFormationValidee n'envoie rien (et ne lève pas) si aucun email n'est renseigné pour le dossier", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: null }));
  const mailMock = t.mock.method(graphMailProvider, 'envoyer', async () => {});

  const resultat = await envoyerEmailFormationValidee(ENTITE_SMS_ACTIF, 69);

  assert.deepEqual(resultat, { emailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 0);
});

// Exigence explicite (audit 2026-08-31, point 6) : un échec d'envoi ne doit jamais se propager —
// c'est ce qui permet à l'appelant (transitions.routes.js) de ne jamais faire échouer la
// transition elle-même à cause de cet envoi.
test("envoyerEmailFormationValidee ne lève jamais, même si le prestataire d'envoi échoue", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: 'sophie.martin@exemple.test' }));
  t.mock.method(graphMailProvider, 'envoyer', async () => {
    throw new Error('Panne Graph simulée');
  });

  const resultat = await envoyerEmailFormationValidee(ENTITE_SMS_ACTIF, 69);

  assert.deepEqual(resultat, { emailEnvoye: false });
});
