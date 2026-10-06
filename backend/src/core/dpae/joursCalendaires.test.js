const test = require('node:test');
const assert = require('node:assert/strict');

const { nombreJoursCalendaires, libelleNombreJours } = require('./joursCalendaires');

test('jours inclus : du 08/10 au 15/10 = 8 jours ; même jour = 1', () => {
  assert.equal(nombreJoursCalendaires('2026-10-08', '2026-10-15'), 8);
  assert.equal(nombreJoursCalendaires('2026-10-08', '2026-10-08'), 1);
  assert.equal(nombreJoursCalendaires('2026-10-08', '2026-10-09'), 2);
});

test('mois et années différents', () => {
  assert.equal(nombreJoursCalendaires('2026-01-31', '2026-02-01'), 2);
  assert.equal(nombreJoursCalendaires('2026-01-01', '2026-12-31'), 365);
  assert.equal(nombreJoursCalendaires('2026-12-30', '2027-01-02'), 4);
});

test('années bissextiles : 2028 compte le 29 février, 2026 non', () => {
  assert.equal(nombreJoursCalendaires('2028-02-28', '2028-03-01'), 3);
  assert.equal(nombreJoursCalendaires('2026-02-28', '2026-03-01'), 2);
  assert.equal(nombreJoursCalendaires('2028-01-01', '2028-12-31'), 366);
});

test('passage à l’heure d’hiver (25/10/2026) et d’été (29/03/2026) : jamais un jour de trop ou de moins', () => {
  assert.equal(nombreJoursCalendaires('2026-10-24', '2026-10-26'), 3);
  assert.equal(nombreJoursCalendaires('2026-10-25', '2026-10-25'), 1);
  assert.equal(nombreJoursCalendaires('2026-03-28', '2026-03-30'), 3);
  // Colonnes `date` relues par le pilote pg : minuit à Paris (UTC+2 l'été, UTC+1 l'hiver), lues à
  // Paris quel que soit le fuseau du serveur.
  assert.equal(nombreJoursCalendaires(new Date('2026-10-23T22:00:00Z'), new Date('2026-10-25T23:00:00Z')), 3);
  assert.equal(nombreJoursCalendaires(new Date('2026-10-24T22:00:00Z'), new Date('2026-10-25T23:00:00Z')), 2);
  assert.equal(nombreJoursCalendaires('2026-03-27T23:00:00.000Z', '2026-03-29T22:00:00.000Z'), 3);
});

test('dates absentes, invalides ou dernier jour antérieur : null', () => {
  assert.equal(nombreJoursCalendaires('2026-10-08', null), null);
  assert.equal(nombreJoursCalendaires('', '2026-10-08'), null);
  assert.equal(nombreJoursCalendaires('n’importe quoi', '2026-10-08'), null);
  assert.equal(nombreJoursCalendaires('2026-10-15', '2026-10-08'), null);
});

test('libellé : « 1 jour », « 8 jours »', () => {
  assert.equal(libelleNombreJours(1), '1 jour');
  assert.equal(libelleNombreJours(8), '8 jours');
});
