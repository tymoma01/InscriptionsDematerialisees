const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');
const siteAffectationRepository = require('./siteAffectationRepository');
const demandeDpaeService = require('./demandeDpaeService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

// Aucune notification stockée à l'envoi (simplification 2026-09-28, demande utilisateur) : tout
// RH voit "toutes les demandes en cours" directement via listerPourRh (consommé par
// NotificationsCloche.jsx côté front pour ce rôle) — rien à créer/synchroniser ici.
test('creerEtEnvoyer crée la demande et ne déclenche aucune notification', async (t) => {
  mockerKnexTransaction(t);
  t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async () => [10]);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  const creerNotificationsMock = t.mock.method(notificationService, 'creerNotifications', async () => {});

  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, {
    salarieNom: 'Martin',
    salariePrenom: 'Sophie',
    sitesAffectationIds: [10],
  });

  assert.equal(demandeId, 7);
  assert.equal(creerNotificationsMock.mock.calls.length, 0);
});

// ---------------------------------------------------------------------------------------------
// Sites d'affectation (référentiel, migration 069, 2026-09-29) — la demande et ses liens sont
// enregistrés dans UNE transaction, et un site invalide refuse toute la demande avant écriture.
// Base factice : `transaction(fn)` appelle fn avec TRX_FACTICE, pour vérifier que TOUTES les
// écritures passent bien par la transaction (jamais par la connexion hors transaction).
// ---------------------------------------------------------------------------------------------
const TRX_FACTICE = { estUneTransaction: true };

function mockerKnexTransaction(t) {
  const transactionMock = t.mock.fn(async (callback) => callback(TRX_FACTICE));
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: transactionMock }));
  return transactionMock;
}

function mockerSites(t, idsValidesEnBase) {
  const listerMock = t.mock.method(siteAffectationRepository, 'listerIdsSitesValides', async (_trx, _entiteId, ids) =>
    ids.filter((id) => idsValidesEnBase.includes(id)),
  );
  const lierMock = t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {});
  const creerMock = t.mock.method(demandeDpaeRepository, 'creerDemande', async () => 7);
  return { listerMock, lierMock, creerMock };
}

const DONNEES_DEMANDE = { salarieNom: 'Martin', salariePrenom: 'Sophie' };

test("creerEtEnvoyer avec un site : demande créée et site lié, dans la transaction ; les ids ne sont pas transmis à l'insertion de la demande", async (t) => {
  const transactionMock = mockerKnexTransaction(t);
  const { listerMock, lierMock, creerMock } = mockerSites(t, [10, 11, 12]);

  const demandeId = await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [10] });

  assert.equal(demandeId, 7);
  assert.equal(transactionMock.mock.calls.length, 1);
  assert.deepEqual(listerMock.mock.calls[0].arguments, [TRX_FACTICE, ENTITE_ACCECIT.id, [10]]);
  assert.equal(creerMock.mock.calls[0].arguments[0], TRX_FACTICE);
  assert.equal('sitesAffectationIds' in creerMock.mock.calls[0].arguments[1], false);
  assert.deepEqual(lierMock.mock.calls[0].arguments, [TRX_FACTICE, 7, [10]]);
});

test('creerEtEnvoyer avec plusieurs sites : tous les liens sont enregistrés', async (t) => {
  mockerKnexTransaction(t);
  const { lierMock } = mockerSites(t, [10, 11, 12]);

  await demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [12, 10, 11] });

  assert.equal(lierMock.mock.calls.length, 1);
  assert.deepEqual(lierMock.mock.calls[0].arguments, [TRX_FACTICE, 7, [12, 10, 11]]);
});

test("creerEtEnvoyer avec un site inexistant, inactif ou d'une autre entité : refus de TOUTE la demande, rien n'est écrit", async (t) => {
  mockerKnexTransaction(t);
  // 10 valide ; 99 absent de la liste des sites actifs de l'entité (inexistant, inactif ou d'une
  // autre entité : le repository ne renvoie que les ids existants, actifs ET de cette entité).
  const { lierMock, creerMock } = mockerSites(t, [10]);

  await assert.rejects(
    () => demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [10, 99] }),
    (erreur) =>
      erreur instanceof demandeDpaeService.ErreurSitesAffectationInvalides && /: 99\. La demande n'a pas été enregistrée\./.test(erreur.message),
  );
  assert.equal(creerMock.mock.calls.length, 0);
  assert.equal(lierMock.mock.calls.length, 0);
});

test("creerEtEnvoyer : si l'enregistrement des liens échoue, l'erreur remonte hors de la transaction (annulation, pas d'enregistrement partiel)", async (t) => {
  mockerKnexTransaction(t);
  mockerSites(t, [10]);
  t.mock.method(siteAffectationRepository, 'lierSitesDemande', async () => {
    throw new Error('violation de clé étrangère');
  });

  // La transaction knex annule tout ce qu'elle contient quand son callback rejette : on vérifie
  // ici que l'erreur n'est pas avalée, condition pour que knex effectue ce rollback.
  await assert.rejects(
    () => demandeDpaeService.creerEtEnvoyer(ENTITE_ACCECIT, 5, { ...DONNEES_DEMANDE, sitesAffectationIds: [10] }),
    /violation de clé étrangère/,
  );
});

test('obtenirDemande renvoie la demande avec ses sites d\'affectation', async (t) => {
  mockerKnex(t);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => ({ id: 7, hotel: null }));
  t.mock.method(siteAffectationRepository, 'listerSitesDemande', async () => [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }]);

  const demande = await demandeDpaeService.obtenirDemande(ENTITE_ACCECIT, 7);

  assert.deepEqual(demande.sites_affectation, [{ id: 10, nom: 'AIGLON', initiales: 'AIG' }]);
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
