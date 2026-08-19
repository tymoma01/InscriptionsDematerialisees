const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const { LIEU_TEST_ACCECIT } = require('../../integrations/notifications/generateurIcs');
// notificationFactory() dispatche par canal vers l'un de ces deux singletons (sms -> AllMySMS,
// email -> Graph, voir notificationFactory.js) : on mocke la méthode `envoyer` de chacun
// directement plutôt que notificationFactory (export de fonction brute, non mockable via
// t.mock.method une fois consommé — même raison que pour storageFactory, voir
// azureOneDriveConnector.test.js). Chaque test touchant le canal email DOIT mocker
// graphMailProvider (jamais seulement allMySmsProvider) : sans ça, l'appel retombe sur le vrai
// client Microsoft Graph (Key Vault + appel réseau réel) plutôt qu'un appel simulé.
const allMySmsProvider = require('../../integrations/notifications/allMySmsProvider');
const graphMailProvider = require('../../integrations/notifications/graphMailProvider');
const invitationTestService = require('./invitationTestService');

// RFC 5545 replie toute ligne dépassant 75 octets sur une ligne suivante commençant par une
// espace/tabulation (voir generateurIcs.test.js) — sans ce dépliage, un .includes() sur une ligne
// longue (LOCATION avec metroAcces, voir ci-dessous) pourrait couper au milieu du texte attendu.
function deplierIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

const ENTITE_SMS_ACTIF = { id: 1, code: 'accecit', sms_actif: true };
const ENTITE_SMS_INACTIF = { id: 1, code: 'accecit', sms_actif: false };

const RENDEZVOUS = { id: 55, dossier_id: 42, date_heure: '2099-01-01T10:00:00.000Z' };
const RENDEZVOUS_AVEC_FORMATEUR = { ...RENDEZVOUS, formateur_id: 7 };
const RENDEZVOUS_AVEC_LIEU = { ...RENDEZVOUS, lieu_id: 3 };
const RENDEZVOUS_AVEC_FORMATEUR_ET_LIEU = { ...RENDEZVOUS, formateur_id: 7, lieu_id: 3 };
// Postes RETENUS pour ce rendez-vous, volontairement différents des postes déclarés à
// l'inscription du dossier (voir mockerKnex, trouverDossierAvecStatutParId ne renvoie aucun
// posteBureau/posteHotel) — le test ci-dessous vérifie que l'email lit bien ceux-ci
// (rendezvous.postes_selectionnes), jamais une donnée résolue depuis le dossier.
const RENDEZVOUS_AVEC_FORMATEUR_ET_POSTES = {
  ...RENDEZVOUS,
  formateur_id: 7,
  postes_selectionnes: ['gouvernant', 'cafetier'],
};

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierAvecStatutParId', async () => ({
    candidat_nom: 'Martin',
    candidat_prenom: 'Sophie',
  }));
}

// Mocke les deux providers d'un coup (voir commentaire en tête de fichier) — chaque test décide
// ensuite lequel des deux mocks il inspecte selon le(s) canal(aux) réellement exercé(s).
function mockerProviders(t, { email = async () => {}, sms = async () => {} } = {}) {
  return {
    mailMock: t.mock.method(graphMailProvider, 'envoyer', email),
    smsMock: t.mock.method(allMySmsProvider, 'envoyer', sms),
  };
}

test("envoyerInvitationTest n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_INACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: false, formateurEmailEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
  assert.equal(smsMock.mock.calls.length, 0);
});

test('envoyerInvitationTest envoie un email avec .ics joint et un SMS quand email et téléphone sont connus', async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: true, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(smsMock.mock.calls.length, 1);

  const appelEmail = mailMock.mock.calls[0];
  assert.equal(appelEmail.arguments[0], 'sophie.martin@exemple.test');
  const { piecesJointes, sujet } = appelEmail.arguments[3];
  assert.equal(sujet, 'Convocation à votre test ACCECIT');
  assert.equal(piecesJointes[0].typeMime, 'text/calendar');
  assert.ok(piecesJointes[0].contenu.toString('utf8').includes('BEGIN:VCALENDAR'));

  const appelSms = smsMock.mock.calls[0];
  assert.equal(appelSms.arguments[0], '0601020304');
});

test("envoyerInvitationTest ajoute le formateur/inspecteur assigné en participant de l'.ics et lui envoie sa propre notification quand rendezvous.formateur_id est renseigné", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  const trouverUtilisateurMock = t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: true });
  assert.equal(trouverUtilisateurMock.mock.calls.length, 1);
  assert.deepEqual(trouverUtilisateurMock.mock.calls[0].arguments.slice(1), [ENTITE_SMS_ACTIF.id, 7]);

  assert.equal(mailMock.mock.calls.length, 2);

  const contenuIcs = mailMock.mock.calls[0].arguments[3].piecesJointes[0].contenu.toString('utf8');
  assert.ok(contenuIcs.includes('marc.dupont@exemple.test'));

  const appelFormateur = mailMock.mock.calls[1];
  assert.equal(appelFormateur.arguments[0], 'marc.dupont@exemple.test');
  assert.equal(appelFormateur.arguments[3].sujet, 'Nouveau candidat à évaluer');
  assert.ok(appelFormateur.arguments[2].includes('Bonjour Marc'));
  assert.ok(appelFormateur.arguments[2].includes('Sophie Martin'));
});

test("envoyerInvitationTest notifie aussi bien un inspecteur (test bureau) qu'un formateur (test hôtel) — le service ne distingue pas le role_code, voir rendezvous.formateur_id : colonne unique partagée par les deux rôles (migration 018)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 9,
    nom: 'Lefevre',
    prenom: 'Julie',
    email: 'julie.lefevre@exemple.test',
    role_code: 'inspecteur',
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 2);

  const appelInspecteur = mailMock.mock.calls[1];
  assert.equal(appelInspecteur.arguments[0], 'julie.lefevre@exemple.test');
  assert.ok(appelInspecteur.arguments[2].includes('Bonjour Julie'));
});

test("envoyerInvitationTest ignore la notification formateur quand le formateur assigné n'a pas d'email renseigné", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: null,
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
});

test("envoyerInvitationTest n'échoue pas si l'envoi de l'email formateur échoue", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  let appels = 0;
  mockerProviders(t, {
    email: async (destinataire) => {
      appels += 1;
      if (destinataire === 'marc.dupont@exemple.test') {
        throw new Error('Microsoft Graph indisponible');
      }
    },
  });

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: false });
  assert.equal(appels, 2);
});

test("envoyerInvitationTest ne recherche aucun formateur quand rendezvous.formateur_id est absent (rendez-vous pas encore assigné)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  const trouverUtilisateurMock = t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => {
    throw new Error('ne doit pas être appelé');
  });
  mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.equal(trouverUtilisateurMock.mock.calls.length, 0);
});

test("envoyerInvitationTest résout rendezvous.lieu_id en champs structurés (adresse/metroAcces/instructions, migration 047) une seule fois, réutilisés pour l'.ics/le SMS (adresse+metroAcces) et l'email (les trois)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  const trouverLieuMock = t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({
    id: 3,
    code: 'hotel_du_cadran',
    adresse: 'Hôtel du Cadran — 14 rue de Valadon, 75007 Paris',
    metro_acces: 'Métro Ecole Militaire - Ligne 8',
    instructions: "Munissez-vous de votre pièce d'identité originale.",
  }));
  const { mailMock, smsMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_LIEU);

  // Une seule résolution du lieu, pas un lookup par canal (voir invitationTestService.js).
  assert.equal(trouverLieuMock.mock.calls.length, 1);
  assert.deepEqual(trouverLieuMock.mock.calls[0].arguments.slice(1), [ENTITE_SMS_ACTIF.id, 3]);

  // .ics et SMS : adresse + metroAcces uniquement (jamais instructions, voir
  // generateurIcs.composerAdresseCourte).
  const contenuIcs = deplierIcs(mailMock.mock.calls[0].arguments[3].piecesJointes[0].contenu.toString('utf8'));
  assert.ok(contenuIcs.includes('LOCATION:Hôtel du Cadran — 14 rue de Valadon\\, 75007 Paris (Métro Ecole Militaire - Ligne 8)'));
  assert.ok(!contenuIcs.includes("pièce d'identité"));

  assert.ok(smsMock.mock.calls[0].arguments[2].includes('Hôtel du Cadran — 14 rue de Valadon, 75007 Paris (Métro Ecole Militaire - Ligne 8)'));

  // Email HTML : seul canal à inclure aussi les instructions (voir formatageEmail.formaterLignesLieuHtml).
  const corpsEmail = mailMock.mock.calls[0].arguments[2];
  assert.ok(corpsEmail.includes('Métro Ecole Militaire - Ligne 8'));
  assert.ok(corpsEmail.includes("Munissez-vous de votre pièce d&#39;identité originale."));
});

test("envoyerInvitationTest inclut les instructions dans l'email candidat mais PAS dans l'email formateur (consignes d'accueil sans objet pour le personnel)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({
    id: 3,
    code: 'hotel_du_cadran',
    adresse: 'Hôtel du Cadran — 14 rue de Valadon, 75007 Paris',
    metro_acces: 'Métro Ecole Militaire - Ligne 8',
    instructions: "Munissez-vous de votre pièce d'identité originale.",
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR_ET_LIEU);

  assert.equal(mailMock.mock.calls.length, 2);

  const corpsCandidat = mailMock.mock.calls[0].arguments[2];
  assert.ok(corpsCandidat.includes('Métro Ecole Militaire - Ligne 8'));
  assert.ok(corpsCandidat.includes("Munissez-vous de votre pièce d&#39;identité originale."));

  const corpsFormateur = mailMock.mock.calls[1].arguments[2];
  assert.ok(corpsFormateur.includes('Métro Ecole Militaire - Ligne 8'));
  assert.ok(!corpsFormateur.includes('identité'));
});

test("envoyerInvitationTest inclut les postes retenus pour CE rendez-vous (rendezvous.postes_selectionnes) dans l'email candidat ET l'email formateur, pas les postes déclarés à l'inscription du dossier", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR_ET_POSTES);

  assert.equal(mailMock.mock.calls.length, 2);

  const corpsCandidat = mailMock.mock.calls[0].arguments[2];
  assert.ok(corpsCandidat.includes('Poste(s) : Gouvernant(e), Cafétier(ère)'));

  const corpsFormateur = mailMock.mock.calls[1].arguments[2];
  assert.ok(corpsFormateur.includes('Poste(s) : Gouvernant(e), Cafétier(ère)'));
});

test("envoyerInvitationTest n'affiche aucune ligne « Poste(s) » quand rendezvous.postes_selectionnes est vide (rendez-vous créé avant la migration 039)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  const { mailMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  const corpsCandidat = mailMock.mock.calls[0].arguments[2];
  assert.ok(!corpsCandidat.includes('Poste(s)'));
});

test("envoyerInvitationTest retombe sur LIEU_TEST_ACCECIT quand rendezvous.lieu_id est absent", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  const trouverLieuMock = t.mock.method(lieuRepository, 'trouverLieuParId', async () => {
    throw new Error('ne doit pas être appelé');
  });
  const { smsMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.equal(trouverLieuMock.mock.calls.length, 0);
  assert.ok(smsMock.mock.calls[0].arguments[2].includes(LIEU_TEST_ACCECIT));
});

test("envoyerInvitationTest ignore un canal sans coordonnée sans faire échouer l'autre", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: false, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(smsMock.mock.calls.length, 0);
});

test("envoyerInvitationTest tente quand même le sms si l'envoi de l'email échoue", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  mockerProviders(t, {
    email: async () => {
      throw new Error('Microsoft Graph indisponible');
    },
  });

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: true, formateurEmailEnvoye: false });
});
