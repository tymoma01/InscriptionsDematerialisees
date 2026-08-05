const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('./dossierRepository');
const relanceRepository = require('./relanceRepository');
const motifRepository = require('../motifs/motifRepository');
// notificationFactory() dispatche par canal vers l'un de ces deux singletons (sms -> AllMySMS,
// email -> Graph, voir notificationFactory.js) : on mocke la méthode `envoyer` du singleton
// concerné directement plutôt que notificationFactory (export de fonction brute), même raison que
// dans invitationTestService.test.js. Mocker le mauvais des deux pour un canal donné laisserait
// passer un vrai appel réseau (Key Vault + Microsoft Graph) au lieu d'un appel simulé.
const allMySmsProvider = require('../../integrations/notifications/allMySmsProvider');
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const relanceService = require('./relanceService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    id: 42,
    statut_code: 'en_attente_pieces',
    candidat_prenom: 'Sophie',
    candidat_nom: 'Martin',
  }));
  t.mock.method(motifRepository, 'trouverMotifParCode', async (bd, entiteId, categorie, code) => ({ id: 1, code }));
}

test("enregistrerRelance rejette si le dossier n'appartient pas à l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => undefined);

  await assert.rejects(
    () => relanceService.enregistrerRelance(ENTITE_ACCECIT, {
      dossierId: 999,
      canal: 'telephone',
      resultat: 'sans_reponse',
      utilisateurId: 1,
    }),
    /Dossier "999" introuvable/,
  );
});

test('enregistrerRelance rejette un canal invalide', async () => {
  await assert.rejects(
    () => relanceService.enregistrerRelance(ENTITE_ACCECIT, {
      dossierId: 42,
      canal: 'fax',
      resultat: 'sans_reponse',
      utilisateurId: 1,
    }),
    /Canal "fax" invalide/,
  );
});

test('enregistrerRelance conserve le résultat choisi par l’agent pour le canal téléphone', async (t) => {
  mockerKnex(t);
  const enregistrerMock = t.mock.method(relanceRepository, 'enregistrerRelance', async () => 10);
  const envoyerMock = t.mock.method(allMySmsProvider, 'envoyer', async () => {});

  const resultatAction = await relanceService.enregistrerRelance(ENTITE_ACCECIT, {
    dossierId: 42,
    canal: 'telephone',
    resultat: 'sans_reponse',
    utilisateurId: 1,
  });

  assert.deepEqual(resultatAction, { relanceId: 10, resultat: 'sans_reponse' });
  assert.equal(envoyerMock.mock.calls.length, 0);
  assert.equal(enregistrerMock.mock.calls[0].arguments[1].resultat, 'sans_reponse');
});

test('enregistrerRelance rejette une relance téléphone sans résultat', async (t) => {
  mockerKnex(t);

  await assert.rejects(
    () => relanceService.enregistrerRelance(ENTITE_ACCECIT, {
      dossierId: 42,
      canal: 'telephone',
      resultat: '',
      utilisateurId: 1,
    }),
    /résultat est obligatoire pour une relance téléphonique/,
  );
});

test("enregistrerRelance envoie réellement un sms et enregistre resultat='envoye' en cas de succès", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ telephone: '0601020304', email: null }));
  const enregistrerMock = t.mock.method(relanceRepository, 'enregistrerRelance', async () => 11);
  const envoyerMock = t.mock.method(allMySmsProvider, 'envoyer', async () => {});

  const resultatAction = await relanceService.enregistrerRelance(ENTITE_ACCECIT, {
    dossierId: 42,
    canal: 'sms',
    // Un resultat fourni par erreur par le front pour sms/email est ignoré, jamais respecté tel
    // quel — voir relanceService.js.
    resultat: 'sans_reponse',
    utilisateurId: 1,
  });

  assert.deepEqual(resultatAction, { relanceId: 11, resultat: 'envoye' });
  assert.equal(envoyerMock.mock.calls.length, 1);
  assert.deepEqual(envoyerMock.mock.calls[0].arguments.slice(0, 2), ['0601020304', 'sms']);
  assert.equal(enregistrerMock.mock.calls[0].arguments[1].resultat, 'envoye');
});

test("enregistrerRelance enregistre resultat='echec_envoi' si le prestataire échoue, sans faire échouer la requête", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: 'sophie@exemple.test', telephone: null }));
  const enregistrerMock = t.mock.method(relanceRepository, 'enregistrerRelance', async () => 12);
  t.mock.method(graphMailProvider, 'envoyer', async () => {
    throw new Error('Microsoft Graph indisponible');
  });

  const resultatAction = await relanceService.enregistrerRelance(ENTITE_ACCECIT, {
    dossierId: 42,
    canal: 'email',
    utilisateurId: 1,
  });

  assert.deepEqual(resultatAction, { relanceId: 12, resultat: 'echec_envoi' });
  assert.equal(enregistrerMock.mock.calls[0].arguments[1].resultat, 'echec_envoi');
});

test("enregistrerRelance rejette un envoi email/sms si l'entité n'a pas activé les notifications", async (t) => {
  mockerKnex(t);

  await assert.rejects(
    () => relanceService.enregistrerRelance(ENTITE_SMS_INACTIF, {
      dossierId: 42,
      canal: 'email',
      utilisateurId: 1,
    }),
    /L'envoi de notifications n'est pas activé/,
  );
});

test("enregistrerRelance rejette un envoi email si le dossier n'a pas d'email renseigné", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: null, telephone: '0601020304' }));

  await assert.rejects(
    () => relanceService.enregistrerRelance(ENTITE_ACCECIT, {
      dossierId: 42,
      canal: 'email',
      utilisateurId: 1,
    }),
    /aucun email renseigné/,
  );
});
