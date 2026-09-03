const { test } = require('node:test');
const assert = require('node:assert/strict');

const { estDansLesPremieresMinutesDeLHeureParis } = require('./fenetreHoraireParis');

// Date UTC choisie pour être sans ambiguïté quelle que soit la saison (heure d'été/hiver Paris) :
// on ne teste que la MINUTE (indépendante du décalage horaire), pas l'heure.

test('estDansLesPremieresMinutesDeLHeureParis : vrai en tout début d’heure (minute 0)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-03T10:00:00Z') });
  assert.equal(estDansLesPremieresMinutesDeLHeureParis(), true);
});

test('estDansLesPremieresMinutesDeLHeureParis : vrai juste avant la fin de la tolérance par défaut (minute 14)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-03T10:14:00Z') });
  assert.equal(estDansLesPremieresMinutesDeLHeureParis(), true);
});

test('estDansLesPremieresMinutesDeLHeureParis : faux à la minute 15 (tolérance par défaut exclusive)', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-03T10:15:00Z') });
  assert.equal(estDansLesPremieresMinutesDeLHeureParis(), false);
});

test('estDansLesPremieresMinutesDeLHeureParis : faux en milieu d’heure', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-03T10:42:00Z') });
  assert.equal(estDansLesPremieresMinutesDeLHeureParis(), false);
});

test('estDansLesPremieresMinutesDeLHeureParis : tolérance personnalisée', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-03T10:20:00Z') });
  assert.equal(estDansLesPremieresMinutesDeLHeureParis(30), true);
  assert.equal(estDansLesPremieresMinutesDeLHeureParis(10), false);
});
