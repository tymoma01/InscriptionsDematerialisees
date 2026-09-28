const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');
const demandeDpaeService = require('./demandeDpaeService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

// Aucune notification stockée à l'envoi (simplification 2026-09-28, demande utilisateur) : tout
// RH voit "toutes les demandes en cours" directement via listerPourRh (consommé par
// NotificationsCloche.jsx côté front pour ce rôle) — rien à créer/synchroniser ici.
test('creerEtEnvoyer crée la demande et ne déclenche aucune notification', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  const creerNotificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, {
    salarieNom: 'Martin',
    salariePrenom: 'Sophie',
  });

  assert.equal(demandeId, 7);
  assert.equal(creerNotificationsMock.mock.calls.length, 0);
});

test('valider rejette une demande introuvable', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => undefined);

  await assert.rejects(
    () => demandeDpaeService.valider(ENTITE_ACCECIT, 999, 1),
    demandeDpaeService.ErreurDemandeIntrouvable,
  );
});

test('valider rejette une demande déjà traitée', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ id: 7, statut: 'validee' }));

  await assert.rejects(
    () => demandeDpaeService.valider(ENTITE_ACCECIT, 7, 1),
    demandeDpaeService.ErreurDemandeDejaTraitee,
  );
});

test('valider marque la demande validée et notifie le demandeur', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({
    id: 7,
    statut: 'envoyee',
    demandeur_id: 3,
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
  }));
  const marquerTraiteeMock = t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => {});
  const creerNotificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  await demandeDpaeService.valider(ENTITE_ACCECIT, 7, 42);

  assert.deepEqual(marquerTraiteeMock.mock.calls[0].arguments[2], { statut: 'validee', traitantId: 42 });
  assert.equal(creerNotificationsMock.mock.calls[0].arguments[1][0].utilisateurId, 3);
});

test('rejeter exige un motif', async (t) => {
  mockerKnex(t);

  await assert.rejects(
    () => demandeDpaeService.rejeter(ENTITE_ACCECIT, 7, 42, '   '),
    /motif de rejet est obligatoire/,
  );
});

test('rejeter marque la demande rejetée avec le motif et notifie le demandeur', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({
    id: 7,
    statut: 'envoyee',
    demandeur_id: 3,
    salarie_nom: 'Martin',
    salarie_prenom: 'Sophie',
  }));
  const marquerTraiteeMock = t.mock.method(demandeDpaeRepository, 'marquerTraitee', async () => {});
  t.mock.method(notificationService, 'creerNotifications', async () => {});

  await demandeDpaeService.rejeter(ENTITE_ACCECIT, 7, 42, '  Poste déjà pourvu  ');

  assert.deepEqual(marquerTraiteeMock.mock.calls[0].arguments[2], {
    statut: 'rejetee',
    traitantId: 42,
    motifRejet: 'Poste déjà pourvu',
  });
});
