const test = require('node:test');
const assert = require('node:assert/strict');

const { genererIcsInvitationTest, composerAdresseCourte, LIEU_TEST_ACCECIT } = require('./generateurIcs');

const INFOS_BASE = {
  dateHeure: '2099-06-15T09:00:00.000Z',
  candidatNom: 'Martin',
  candidatPrenom: 'Sophie',
};

// RFC 5545 replie toute ligne dépassant 75 octets sur une ligne suivante commençant par une
// espace/tabulation (voir CN="Sophi\r\n\te Martin" dans la sortie brute de `ics`, constaté en
// inspectant le fichier généré) — sans ce dépliage, un simple .includes() sur une ligne pourrait
// couper au milieu d'un nom/email et faire échouer une assertion pourtant correcte.
function deplierIcs(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

test('genererIcsInvitationTest ne pose aucun ATTENDEE sans email connu', () => {
  const ics = deplierIcs(genererIcsInvitationTest(INFOS_BASE));

  assert.ok(ics.includes('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('SUMMARY:Test ACCECIT'));
  assert.ok(ics.includes(`LOCATION:${LIEU_TEST_ACCECIT.replace(',', '\\,')}`));
  assert.ok(!ics.includes('ATTENDEE'));
});

// composerAdresseCourte (voir generateurIcs.js) : réutilisée pour `location` ci-dessous ET pour le
// SMS (invitationTestService.js/notificationChangementLieuService.js) — jamais `instructions`,
// réservé à l'email HTML (formatageEmail.formaterLignesLieuHtml).
test("composerAdresseCourte compose 'adresse (metroAcces)' quand l'accès est renseigné, l'adresse seule sinon", () => {
  assert.equal(
    composerAdresseCourte({ adresse: 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris', metroAcces: 'Métro Ecole Militaire - Ligne 8' }),
    'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris (Métro Ecole Militaire - Ligne 8)',
  );
  assert.equal(composerAdresseCourte({ adresse: 'Bureau ACCECIT' }), 'Bureau ACCECIT');
});

test("genererIcsInvitationTest pose LOCATION avec l'adresse et le métro/accès du lieu structuré (champs lieuAdresse/lieuMetroAcces), jamais les instructions", () => {
  const ics = deplierIcs(
    genererIcsInvitationTest({
      ...INFOS_BASE,
      lieuAdresse: 'Hôtel du Cadran - 14 Rue de Valadon, 75007 Paris',
      lieuMetroAcces: 'Métro Ecole Militaire - Ligne 8',
      lieuInstructions: "Munissez-vous de votre pièce d'identité originale.",
    }),
  );

  assert.ok(ics.includes('LOCATION:Hôtel du Cadran - 14 Rue de Valadon\\, 75007 Paris (Métro Ecole Militaire - Ligne 8)'));
  assert.ok(!ics.includes("pièce d'identité"));
});

// DTSTART doit porter le suffixe Z (instant UTC absolu), jamais une heure "flottante" sans fuseau
// — voir generateurIcs.js pour le raisonnement complet (une heure flottante s'affiche dans le
// fuseau du client, pas forcément Europe/Paris, silencieusement faux pour qui n'est pas réglé
// dessus). 09:00 UTC le 15/06 (été, CEST = UTC+2) correspond à 11:00 heure de Paris.
test('genererIcsInvitationTest pose un DTSTART en UTC (suffixe Z), jamais une heure flottante', () => {
  const ics = deplierIcs(genererIcsInvitationTest(INFOS_BASE));

  assert.ok(ics.includes('DTSTART:20990615T090000Z'));
});

test("genererIcsInvitationTest ajoute le candidat en ATTENDEE quand son email est fourni", () => {
  const ics = deplierIcs(genererIcsInvitationTest({ ...INFOS_BASE, candidatEmail: 'sophie.martin@exemple.test' }));

  const lignesAttendee = ics.split('\r\n').filter((ligne) => ligne.startsWith('ATTENDEE'));
  assert.equal(lignesAttendee.length, 1);
  assert.ok(lignesAttendee[0].includes('CN="Sophie Martin"'));
  assert.ok(lignesAttendee[0].includes(':mailto:sophie.martin@exemple.test'));
});

test('genererIcsInvitationTest ajoute aussi le formateur en ATTENDEE quand son email est fourni', () => {
  const ics = deplierIcs(
    genererIcsInvitationTest({
      ...INFOS_BASE,
      candidatEmail: 'sophie.martin@exemple.test',
      formateurNom: 'Dupont',
      formateurPrenom: 'Marc',
      formateurEmail: 'marc.dupont@exemple.test',
    }),
  );

  const lignesAttendee = ics.split('\r\n').filter((ligne) => ligne.startsWith('ATTENDEE'));
  assert.equal(lignesAttendee.length, 2);
  assert.ok(lignesAttendee.some((ligne) => ligne.includes(':mailto:sophie.martin@exemple.test')));
  assert.ok(
    lignesAttendee.some((ligne) => ligne.includes('CN="Marc Dupont"') && ligne.includes(':mailto:marc.dupont@exemple.test')),
  );
});

test('genererIcsInvitationTest ignore le formateur si seuls son nom/prénom sont fournis sans email', () => {
  const ics = deplierIcs(
    genererIcsInvitationTest({
      ...INFOS_BASE,
      candidatEmail: 'sophie.martin@exemple.test',
      formateurNom: 'Dupont',
      formateurPrenom: 'Marc',
    }),
  );

  const lignesAttendee = ics.split('\r\n').filter((ligne) => ligne.startsWith('ATTENDEE'));
  assert.equal(lignesAttendee.length, 1);
});

// Voir generateurIcs.js : ORGANIZER volontairement omis (aucune adresse d'expédition ACCECIT
// documentée) plutôt que publié à moitié (CN= sans valeur mailto:, invalide en iCalendar).
test('genererIcsInvitationTest ne pose jamais de ligne ORGANIZER (aucune adresse ACCECIT disponible)', () => {
  const ics = deplierIcs(genererIcsInvitationTest({ ...INFOS_BASE, candidatEmail: 'sophie.martin@exemple.test' }));

  assert.ok(!ics.includes('ORGANIZER'));
});

// Sans rendezvousId (appelant qui ne régénère jamais cet .ics pour le même rendez-vous) :
// comportement d'origine, un UID aléatoire par appel, aucune ligne SEQUENCE — ne doit surtout pas
// planter (voir le bug corrigé : passer `uid`/`sequence` à `undefined` explicitement à la lib
// `ics` la fait planter, ces deux clés doivent être absentes de l'objet, pas juste undefined).
test("genererIcsInvitationTest génère un UID aléatoire et omet SEQUENCE quand rendezvousId n'est pas fourni", () => {
  const ics = deplierIcs(genererIcsInvitationTest(INFOS_BASE));

  assert.ok(/UID:\S+/.test(ics));
  assert.ok(!ics.includes('SEQUENCE'));
});

// rendezvousId : UID stable et prévisible, pour qu'un appel ultérieur portant le même
// rendezvousId (voir notificationChangementLieuService.js, changement de lieu) produise le MÊME
// UID — c'est ce qui permet à un client calendrier de reconnaître une mise à jour du même
// événement plutôt que d'importer un second événement en doublon (voir RFC 5545).
test('genererIcsInvitationTest dérive un UID stable de rendezvousId, identique à chaque appel pour le même rendez-vous', () => {
  const ics1 = genererIcsInvitationTest({ ...INFOS_BASE, rendezvousId: 55 });
  const ics2 = genererIcsInvitationTest({ ...INFOS_BASE, rendezvousId: 55, lieuAdresse: 'Une autre adresse' });

  const uid1 = ics1.match(/UID:(\S+)/)[1];
  const uid2 = ics2.match(/UID:(\S+)/)[1];
  assert.equal(uid1, uid2);
  assert.equal(uid1, 'rendezvous-55@accecit.com');
});

// sequence : posé tel quel (0, 1, ...) quand fourni — c'est ce compteur, avec l'UID identique
// ci-dessus, qui signale au client calendrier qu'une version plus récente remplace la précédente.
test("genererIcsInvitationTest pose SEQUENCE quand fourni, même à 0 (valeur falsy mais valide)", () => {
  const icsSequence0 = deplierIcs(genererIcsInvitationTest({ ...INFOS_BASE, rendezvousId: 1, sequence: 0 }));
  const icsSequence1 = deplierIcs(genererIcsInvitationTest({ ...INFOS_BASE, rendezvousId: 1, sequence: 1 }));

  assert.ok(icsSequence0.includes('SEQUENCE:0'));
  assert.ok(icsSequence1.includes('SEQUENCE:1'));
});
