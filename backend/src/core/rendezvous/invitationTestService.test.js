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
// Note de planification (migration 049) — saisie par l'agent Accueil/Coordination à la
// planification (ModalePlanificationTest.jsx), distincte des notes générales du dossier. Le test
// ci-dessous vérifie qu'elle apparaît dans l'email FORMATEUR uniquement, jamais dans l'email
// candidat (construireMessageEmail ne reçoit jamais ce champ, voir invitationTestService.js).
const RENDEZVOUS_AVEC_FORMATEUR_ET_NOTE = {
  ...RENDEZVOUS,
  formateur_id: 7,
  note_planification: 'Candidat très timide, à mettre en confiance dès le début du test.',
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

// Ligne "Contact d'urgence" (audit 2026-08-28, reformulée le même jour — "le jour du test" retiré
// pour rester valable même en cas de contact avant le jour J) : coordonnées ACCECIT déjà affichées
// dans le footer de l'app (PiedDePageFormulaire.jsx/PiedDePageAccecit.jsx), positionnée après le
// bloc lieu et avant la mention de la pièce jointe .ics, colorée en bleu ACCECIT
// (--couleur-primaire, #2d3c92, styles/variables.css) — pas une couleur d'alerte.
test("envoyerInvitationTest inclut une ligne « Contact d'urgence » en bleu ACCECIT dans l'email candidat, entre le lieu et la pièce jointe .ics", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: null,
  }));
  const { mailMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS);

  const corpsCandidat = mailMock.mock.calls[0].arguments[2];
  assert.ok(
    corpsCandidat.includes(
      '<p style="color: #2d3c92;">En cas de besoin, vous pouvez nous contacter au ' +
        '01 56 56 69 56 (47 avenue Paul Vaillant Couturier, 94250 Gentilly).</p>',
    ),
  );
  const indexContact = corpsCandidat.indexOf('En cas de besoin, vous pouvez nous contacter');
  const indexIcs = corpsCandidat.indexOf('Vous trouverez en pièce jointe une invitation');
  assert.ok(indexContact > 0 && indexContact < indexIcs, 'la ligne de contact doit précéder la mention .ics');
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
  // Texte revu (audit 2026-08-28, tiret simple, pas cadratin) : le rendez-vous n'ajoute plus le
  // formateur/inspecteur en `attendee` sur l'événement Graph (voir graphCalendarService.js), donc
  // cet email + son .ics restent la SEULE notification qu'il reçoit — le texte doit refléter
  // explicitement que l'événement est déjà sur son calendrier Outlook, pas seulement "prévu".
  assert.ok(appelFormateur.arguments[2].includes("prévu le"));
  assert.ok(appelFormateur.arguments[2].includes("- L'évènement est présent sur votre calendrier outlook."));

  // Régression (audit 2026-08-20) : l'email formateur n'attachait jusqu'ici jamais l'.ics
  // (contenuIcs était scopé au seul bloc candidat) — même fichier que l'email candidat ci-dessus.
  const piecesJointesFormateur = appelFormateur.arguments[3].piecesJointes;
  assert.equal(piecesJointesFormateur[0].nom, 'convocation-test-accecit.ics');
  assert.equal(piecesJointesFormateur[0].typeMime, 'text/calendar');
  assert.equal(piecesJointesFormateur[0].contenu.toString('utf8'), contenuIcs);
});

// Préférence "Mon profil" (migration 056, recevoir_email_planification) — audit 2026-08-28.
test("envoyerInvitationTest n'envoie PAS l'email formateur quand recevoir_email_planification vaut false, mais envoie quand même l'email/SMS candidat", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({
    email: 'sophie.martin@exemple.test',
    telephone: '0601020304',
  }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
    recevoir_email_planification: false,
  }));
  const { mailMock, smsMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  assert.deepEqual(resultat, { emailEnvoye: true, smsEnvoye: true, formateurEmailEnvoye: false });
  // Un seul appel email (candidat) — aucun second appel vers marc.dupont@exemple.test.
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'sophie.martin@exemple.test');
  assert.equal(smsMock.mock.calls.length, 1);
});

// Défaut true (migration 056, defaultTo) : un formateur/inspecteur dont le mock ne renseigne pas
// explicitement ce champ (undefined, comme tous les autres tests de ce fichier écrits avant cette
// préférence) doit continuer à recevoir l'email — comportement inchangé pour tout compte existant
// tant qu'il n'a pas explicitement décoché la case dans "Mon profil".
test("envoyerInvitationTest envoie l'email formateur quand recevoir_email_planification est absent (undefined), même défaut que la colonne en base", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: null, telephone: null }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  assert.equal(resultat.formateurEmailEnvoye, true);
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'marc.dupont@exemple.test');
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

test("envoyerInvitationTest inclut « Note de l'agent : ... » dans l'email FORMATEUR quand rendezvous.note_planification est renseignée, jamais dans l'email candidat", async (t) => {
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

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR_ET_NOTE);

  assert.equal(mailMock.mock.calls.length, 2);

  const corpsCandidat = mailMock.mock.calls[0].arguments[2];
  assert.ok(!corpsCandidat.includes("Note de l'agent"));
  assert.ok(!corpsCandidat.includes('timide'));

  const corpsFormateur = mailMock.mock.calls[1].arguments[2];
  assert.ok(
    corpsFormateur.includes(
      "Note de l'agent : Candidat très timide, à mettre en confiance dès le début du test.",
    ),
  );
});

test("envoyerInvitationTest n'affiche aucune ligne « Note de l'agent » dans l'email formateur quand rendezvous.note_planification est absente", async (t) => {
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

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  const corpsFormateur = mailMock.mock.calls[1].arguments[2];
  assert.ok(!corpsFormateur.includes("Note de l'agent"));
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

// Audit 2026-08-28 : consolidation de la notification formateur/inspecteur lors d'une
// replanification — un seul email envoyé (déjà garanti par envoyerInvitationTest, appelé une seule
// fois par planificationRendezvousService.js dans les deux cas), mais avec un texte différent qui
// mentionne EXPLICITEMENT l'ancien ET le nouveau créneau plutôt que le texte générique "Nouveau
// candidat à évaluer" utilisé pour une planification initiale.
const RENDEZVOUS_REPLANIFIE = {
  ...RENDEZVOUS_AVEC_FORMATEUR,
  date_heure: '2099-02-15T14:00:00.000Z',
  ancienRendezVous: { id: 40, date_heure: '2099-01-01T10:00:00.000Z' },
};

test('envoyerInvitationTest envoie un email formateur "Test replanifié" mentionnant les deux créneaux quand rendezvous.ancienRendezVous est renseigné', async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: null, telephone: null }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_REPLANIFIE);

  assert.deepEqual(resultat, { emailEnvoye: false, smsEnvoye: false, formateurEmailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 1, 'un seul envoi, jamais un email distinct pour l\'ancien créneau');

  const appelFormateur = mailMock.mock.calls[0];
  assert.equal(appelFormateur.arguments[0], 'marc.dupont@exemple.test');
  assert.equal(appelFormateur.arguments[3].sujet, 'Test replanifié');
  const corps = appelFormateur.arguments[2];
  assert.ok(corps.includes('initialement prévu le'));
  assert.ok(corps.includes('a été replanifié pour le'));
  // Ancienne ET nouvelle date toutes les deux présentes (formatées en "long", voir FORMAT_DATE_SEULE)
  assert.ok(corps.includes('janvier 2099'), "date de l'ANCIEN créneau absente du texte");
  assert.ok(corps.includes('février 2099'), 'date du NOUVEAU créneau absente du texte');
  // Jamais le texte de planification initiale dans ce cas.
  assert.ok(!corps.includes('Vous êtes assigné'));
});

test("envoyerInvitationTest garde le texte « Nouveau candidat à évaluer » quand rendezvous.ancienRendezVous est absent (planification initiale)", async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => ({ email: null, telephone: null }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  await invitationTestService.envoyerInvitationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_AVEC_FORMATEUR);

  const appelFormateur = mailMock.mock.calls[0];
  assert.equal(appelFormateur.arguments[3].sujet, 'Nouveau candidat à évaluer');
  assert.ok(appelFormateur.arguments[2].includes('Vous êtes assigné'));
  assert.ok(!appelFormateur.arguments[2].includes('replanifié'));
});

// Annulation SIMPLE (pas une replanification) — audit 2026-08-28 : n'existait pas avant ce
// chantier, changerStatutRendezvous ne notifiait jusqu'ici jamais le formateur/inspecteur.
// Candidat ET formateur/inspecteur depuis le 2026-09-02 (décision utilisateur : "en cas de
// changement de planification, toutes les parties prenantes doivent être notifiées") — annule la
// restriction "formateur/inspecteur uniquement" du 2026-08-28.
const RENDEZVOUS_ANNULE = { id: 60, dossier_id: 42, formateur_id: 7, date_heure: '2099-03-01T09:00:00.000Z' };

function mockerCoordonneesCandidat(t, coordonnees = { email: 'sophie.martin@exemple.test' }) {
  t.mock.method(dossierRepository, 'trouverCoordonneesCandidat', async () => coordonnees);
}

test('envoyerNotificationAnnulationTest envoie un email "Votre test ACCECIT est annulé" au candidat ET un email "Test annulé" au formateur/inspecteur, sans pièce jointe', async (t) => {
  mockerKnex(t);
  mockerCoordonneesCandidat(t);
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerNotificationAnnulationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_ANNULE);

  assert.deepEqual(resultat, { candidatEmailEnvoye: true, formateurEmailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 2);

  const appelCandidat = mailMock.mock.calls[0];
  assert.equal(appelCandidat.arguments[0], 'sophie.martin@exemple.test');
  assert.equal(appelCandidat.arguments[3].sujet, 'Votre test ACCECIT est annulé');
  assert.equal(appelCandidat.arguments[3].piecesJointes, undefined);
  assert.ok(appelCandidat.arguments[2].includes('Bonjour Sophie Martin'));
  assert.ok(appelCandidat.arguments[2].includes('est annulé'));
  assert.ok(appelCandidat.arguments[2].includes('Nous reviendrons vers vous prochainement'));

  const appelFormateur = mailMock.mock.calls[1];
  assert.equal(appelFormateur.arguments[0], 'marc.dupont@exemple.test');
  assert.equal(appelFormateur.arguments[3].sujet, 'Test annulé');
  assert.equal(appelFormateur.arguments[3].piecesJointes, undefined);
  assert.ok(appelFormateur.arguments[2].includes('Bonjour Marc'));
  assert.ok(appelFormateur.arguments[2].includes('Sophie Martin'));
  assert.ok(appelFormateur.arguments[2].includes('est annulé'));
});

test("envoyerNotificationAnnulationTest n'envoie rien si sms_actif est faux pour l'entité", async (t) => {
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerNotificationAnnulationTest(ENTITE_SMS_INACTIF, RENDEZVOUS_ANNULE);

  assert.deepEqual(resultat, { candidatEmailEnvoye: false, formateurEmailEnvoye: false, desactive: true });
  assert.equal(mailMock.mock.calls.length, 0);
});

test("envoyerNotificationAnnulationTest notifie quand même le candidat si le rendez-vous annulé n'a pas de formateur assigné", async (t) => {
  mockerKnex(t);
  mockerCoordonneesCandidat(t);
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerNotificationAnnulationTest(ENTITE_SMS_ACTIF, {
    ...RENDEZVOUS_ANNULE,
    formateur_id: null,
  });

  assert.deepEqual(resultat, { candidatEmailEnvoye: true, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'sophie.martin@exemple.test');
});

test("envoyerNotificationAnnulationTest n'envoie rien au formateur si son email n'est pas renseigné, mais notifie quand même le candidat", async (t) => {
  mockerKnex(t);
  mockerCoordonneesCandidat(t);
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({ id: 7, nom: 'Dupont', prenom: 'Marc', email: null }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerNotificationAnnulationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_ANNULE);

  assert.deepEqual(resultat, { candidatEmailEnvoye: true, formateurEmailEnvoye: false });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'sophie.martin@exemple.test');
});

test("envoyerNotificationAnnulationTest n'envoie rien au candidat si son email n'est pas renseigné, mais notifie quand même le formateur/inspecteur", async (t) => {
  mockerKnex(t);
  mockerCoordonneesCandidat(t, { email: null });
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 7,
    nom: 'Dupont',
    prenom: 'Marc',
    email: 'marc.dupont@exemple.test',
  }));
  const { mailMock } = mockerProviders(t);

  const resultat = await invitationTestService.envoyerNotificationAnnulationTest(ENTITE_SMS_ACTIF, RENDEZVOUS_ANNULE);

  assert.deepEqual(resultat, { candidatEmailEnvoye: false, formateurEmailEnvoye: true });
  assert.equal(mailMock.mock.calls.length, 1);
  assert.equal(mailMock.mock.calls[0].arguments[0], 'marc.dupont@exemple.test');
});
