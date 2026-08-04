const test = require('node:test');
const assert = require('node:assert/strict');

const { genererIcsInvitationTest, LIEU_TEST_ACCECIT } = require('./generateurIcs');

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
