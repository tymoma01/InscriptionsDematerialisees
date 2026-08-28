const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const utilisateurRepository = require('./utilisateurRepository');
const utilisateurService = require('./utilisateurService');

// mettreAJourMonProfil (audit 2026-08-28, écran self-service "Mon profil") — seuls
// telephone/recevoirEmailPlanification passent par ce chemin, jamais nom/prenom/email/roleCode
// (voir moi.routes.js pour la garantie que utilisateurId vient toujours de la session, jamais
// d'un autre compte).

test('mettreAJourMonProfil ne transmet à la mise à jour que les champs fournis (telephone seul)', async (t) => {
  const bd = {};
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const mettreAJourMock = t.mock.method(utilisateurRepository, 'mettreAJourUtilisateur', async () => ({ id: 7 }));

  await utilisateurService.mettreAJourMonProfil(7, { telephone: '0601020304' });

  assert.deepEqual(mettreAJourMock.mock.calls[0].arguments.slice(1), [7, { telephone: '0601020304' }]);
});

test('mettreAJourMonProfil convertit un téléphone vide en null (suppression du numéro), même convention que mettreAJourUtilisateur', async (t) => {
  const bd = {};
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const mettreAJourMock = t.mock.method(utilisateurRepository, 'mettreAJourUtilisateur', async () => ({ id: 7 }));

  await utilisateurService.mettreAJourMonProfil(7, { telephone: '' });

  assert.deepEqual(mettreAJourMock.mock.calls[0].arguments[2], { telephone: null });
});

test('mettreAJourMonProfil transmet recevoirEmailPlanification seul quand telephone est absent', async (t) => {
  const bd = {};
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const mettreAJourMock = t.mock.method(utilisateurRepository, 'mettreAJourUtilisateur', async () => ({ id: 7 }));

  await utilisateurService.mettreAJourMonProfil(7, { recevoirEmailPlanification: false });

  assert.deepEqual(mettreAJourMock.mock.calls[0].arguments[2], { recevoir_email_planification: false });
});

test('mettreAJourMonProfil combine les deux champs quand les deux sont fournis', async (t) => {
  const bd = {};
  t.mock.method(db, 'obtenirKnex', async () => bd);
  const mettreAJourMock = t.mock.method(utilisateurRepository, 'mettreAJourUtilisateur', async () => ({ id: 7 }));

  await utilisateurService.mettreAJourMonProfil(7, { telephone: '0601020304', recevoirEmailPlanification: true });

  assert.deepEqual(mettreAJourMock.mock.calls[0].arguments[2], {
    telephone: '0601020304',
    recevoir_email_planification: true,
  });
});
