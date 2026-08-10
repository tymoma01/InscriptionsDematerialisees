const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const lieuRepository = require('./lieuRepository');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const notificationChangementLieuService = require('../rendezvous/notificationChangementLieuService');
const lieuService = require('./lieuService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

test('creerLieu dérive un code à partir du libellé (accents retirés, tout non-alphanumérique réduit à "_")', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParCode', async () => undefined);
  let codeRecu;
  t.mock.method(lieuRepository, 'creerLieu', async (bd, entiteId, { code, libelle }) => {
    codeRecu = code;
    return [{ id: 42, code, libelle, actif: true }];
  });

  const lieu = await lieuService.creerLieu(ENTITE_ACCECIT, {
    libelle: 'Hôtel du Cadran - 14 rue de Valadon, 75007 Paris',
  });

  assert.equal(codeRecu, 'hotel_du_cadran_14_rue_de_valadon_75007_paris');
  assert.equal(lieu.id, 42);
  assert.equal(lieu.libelle, 'Hôtel du Cadran - 14 rue de Valadon, 75007 Paris');
});

test("creerLieu ajoute un suffixe numérique si le code généré est déjà pris par un lieu de l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParCode', async (bd, entiteId, code) =>
    code === 'agence' ? { id: 1, code } : undefined,
  );
  let codeRecu;
  t.mock.method(lieuRepository, 'creerLieu', async (bd, entiteId, { code, libelle }) => {
    codeRecu = code;
    return [{ id: 43, code, libelle, actif: true }];
  });

  await lieuService.creerLieu(ENTITE_ACCECIT, { libelle: 'Agence' });

  assert.equal(codeRecu, 'agence_2');
});

test('creerLieu retombe sur le code "lieu" si le libellé ne contient aucun caractère alphanumérique', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParCode', async () => undefined);
  let codeRecu;
  t.mock.method(lieuRepository, 'creerLieu', async (bd, entiteId, { code, libelle }) => {
    codeRecu = code;
    return [{ id: 44, code, libelle, actif: true }];
  });

  await lieuService.creerLieu(ENTITE_ACCECIT, { libelle: '---' });

  assert.equal(codeRecu, 'lieu');
});

test('modifierLieu met à jour le libellé sans toucher au code', async (t) => {
  mockerKnex(t);
  let argsRecus;
  t.mock.method(lieuRepository, 'modifierLieu', async (bd, entiteId, lieuId, donnees) => {
    argsRecus = { entiteId, lieuId, donnees };
    return [{ id: lieuId, code: 'hotel_du_cadran', libelle: donnees.libelle, actif: true }];
  });

  const lieu = await lieuService.modifierLieu(ENTITE_ACCECIT, 1, { libelle: 'Nouvelle adresse' });

  assert.deepEqual(argsRecus, { entiteId: 1, lieuId: 1, donnees: { libelle: 'Nouvelle adresse' } });
  assert.equal(lieu.libelle, 'Nouvelle adresse');
  assert.equal(lieu.code, 'hotel_du_cadran');
});

test("modifierLieu lève ErreurLieuIntrouvable si le lieu n'existe pas pour cette entité (id inconnu, ou d'une autre entité)", async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'modifierLieu', async () => []);

  await assert.rejects(
    () => lieuService.modifierLieu(ENTITE_ACCECIT, 999, { libelle: 'Adresse' }),
    (erreur) => erreur instanceof lieuService.ErreurLieuIntrouvable,
  );
});

const RENDEZVOUS_ASSOCIES = [
  {
    id: 10,
    dossier_id: 100,
    date_heure: '2099-01-01T10:00:00.000Z',
    statut: 'prevu',
    candidat_prenom: 'Sophie',
    candidat_nom: 'Martin',
    donnees_coordonnees: { email: 'sophie.martin@exemple.test', telephone: '0601020304' },
  },
  {
    id: 11,
    dossier_id: 101,
    date_heure: '2099-01-02T10:00:00.000Z',
    statut: 'confirme',
    candidat_prenom: 'Bruno',
    candidat_nom: 'Durand',
    donnees_coordonnees: { email: 'bruno.durand@exemple.test', telephone: null },
  },
];

// bd.transaction attendu par supprimerLieu (chemin migration) — le trx transmis aux repositories
// mockés n'est jamais inspecté par ces tests (seuls les repositories sont mockés), juste besoin
// que .transaction(fn) exécute bien `fn` et retourne sa valeur.
function mockerKnexAvecTransaction(t) {
  const trx = { marqueurTrx: true };
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (fn) => fn(trx) }));
  return trx;
}

test('listerRendezvousAssocies renvoie la forme candidat/date, jamais les coordonnées (email/téléphone)', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({ id: 1, libelle: 'Hôtel du Cadran' }));
  t.mock.method(rendezvousRepository, 'listerRendezvousParLieu', async () => RENDEZVOUS_ASSOCIES);

  const resultat = await lieuService.listerRendezvousAssocies(ENTITE_ACCECIT, 1);

  assert.deepEqual(resultat, [
    { id: 10, dateHeure: '2099-01-01T10:00:00.000Z', candidatNom: 'Martin', candidatPrenom: 'Sophie' },
    { id: 11, dateHeure: '2099-01-02T10:00:00.000Z', candidatNom: 'Durand', candidatPrenom: 'Bruno' },
  ]);
  assert.ok(!JSON.stringify(resultat).includes('exemple.test'), 'les coordonnées ne doivent jamais fuiter dans la réponse');
});

test("listerRendezvousAssocies lève ErreurLieuIntrouvable si le lieu n'existe pas pour cette entité", async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => undefined);

  await assert.rejects(
    () => lieuService.listerRendezvousAssocies(ENTITE_ACCECIT, 999),
    (erreur) => erreur instanceof lieuService.ErreurLieuIntrouvable,
  );
});

test('supprimerLieu sans rendez-vous associé supprime directement, sans migration ni notification', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({ id: 1, libelle: 'Salle vide' }));
  t.mock.method(rendezvousRepository, 'listerRendezvousParLieu', async () => []);
  const migrerMock = t.mock.method(rendezvousRepository, 'migrerRendezvousVersLieu', async () => {
    throw new Error('ne doit pas être appelé');
  });
  const supprimerMock = t.mock.method(lieuRepository, 'supprimerLieu', async () => 1);
  const notifierMock = t.mock.method(notificationChangementLieuService, 'envoyerNotificationChangementLieu', async () => {
    throw new Error('ne doit pas être appelé');
  });

  const resultat = await lieuService.supprimerLieu(ENTITE_ACCECIT, 1);

  assert.deepEqual(resultat, {
    lieu: { id: 1, libelle: 'Salle vide' },
    lieuDestination: null,
    rendezvousMigres: 0,
    rendezvousAssocies: [],
    notifications: [],
  });
  assert.equal(supprimerMock.mock.calls.length, 1);
  assert.equal(migrerMock.mock.calls.length, 0);
  assert.equal(notifierMock.mock.calls.length, 0);
});

test('supprimerLieu avec rendez-vous associés mais sans lieuDestinationId lève ErreurMigrationRequise (porte la liste, ne supprime rien)', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({ id: 1, libelle: 'Salle occupée' }));
  t.mock.method(rendezvousRepository, 'listerRendezvousParLieu', async () => RENDEZVOUS_ASSOCIES);
  const supprimerMock = t.mock.method(lieuRepository, 'supprimerLieu', async () => {
    throw new Error('ne doit pas être appelé');
  });

  await assert.rejects(
    () => lieuService.supprimerLieu(ENTITE_ACCECIT, 1),
    (erreur) => {
      assert.ok(erreur instanceof lieuService.ErreurMigrationRequise);
      assert.equal(erreur.rendezvousAssocies.length, 2);
      assert.equal(erreur.rendezvousAssocies[0].candidatNom, 'Martin');
      return true;
    },
  );
  assert.equal(supprimerMock.mock.calls.length, 0);
});

test('supprimerLieu rejette une destination identique au lieu supprimé', async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({ id: 1, libelle: 'Salle occupée' }));
  t.mock.method(rendezvousRepository, 'listerRendezvousParLieu', async () => RENDEZVOUS_ASSOCIES);

  await assert.rejects(
    () => lieuService.supprimerLieu(ENTITE_ACCECIT, 1, { lieuDestinationId: 1 }),
    (erreur) => erreur instanceof lieuService.ErreurLieuDestinationInvalide,
  );
});

test("supprimerLieu rejette une destination introuvable pour l'entité", async (t) => {
  mockerKnex(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async (bd, entiteId, lieuId) => (lieuId === 1 ? { id: 1, libelle: 'Salle occupée' } : undefined));
  t.mock.method(rendezvousRepository, 'listerRendezvousParLieu', async () => RENDEZVOUS_ASSOCIES);

  await assert.rejects(
    () => lieuService.supprimerLieu(ENTITE_ACCECIT, 1, { lieuDestinationId: 999 }),
    (erreur) => erreur instanceof lieuService.ErreurLieuDestinationInvalide,
  );
});

test('supprimerLieu avec destination valide migre puis supprime dans une transaction, puis notifie chaque candidat migré', async (t) => {
  const trx = mockerKnexAvecTransaction(t);
  t.mock.method(lieuRepository, 'trouverLieuParId', async (bd, entiteId, lieuId) =>
    lieuId === 1 ? { id: 1, libelle: 'Salle occupée' } : { id: 2, libelle: 'Salle Annexe - 3 rue des Tests, 75001 Paris' },
  );
  t.mock.method(rendezvousRepository, 'listerRendezvousParLieu', async () => RENDEZVOUS_ASSOCIES);
  const migrerMock = t.mock.method(rendezvousRepository, 'migrerRendezvousVersLieu', async (bdRecu, args) => {
    assert.equal(bdRecu, trx, 'la migration doit se faire dans la transaction, pas hors de celle-ci');
    assert.deepEqual(args, { lieuIdOrigine: 1, lieuIdDestination: 2 });
    return 2;
  });
  const supprimerMock = t.mock.method(lieuRepository, 'supprimerLieu', async (bdRecu, entiteId, lieuId) => {
    assert.equal(bdRecu, trx, 'la suppression doit se faire dans la même transaction que la migration');
    assert.equal(lieuId, 1);
    return 1;
  });
  const notifierMock = t.mock.method(notificationChangementLieuService, 'envoyerNotificationChangementLieu', async () => ({
    emailEnvoye: true,
    smsEnvoye: true,
  }));

  const resultat = await lieuService.supprimerLieu(ENTITE_ACCECIT, 1, { lieuDestinationId: 2 });

  assert.equal(migrerMock.mock.calls.length, 1);
  assert.equal(supprimerMock.mock.calls.length, 1);
  assert.equal(notifierMock.mock.calls.length, 2, 'une notification par rendez-vous migré');
  assert.deepEqual(notifierMock.mock.calls[0].arguments, [
    ENTITE_ACCECIT,
    RENDEZVOUS_ASSOCIES[0],
    'Salle Annexe - 3 rue des Tests, 75001 Paris',
  ]);

  assert.equal(resultat.rendezvousMigres, 2);
  assert.equal(resultat.lieuDestination.id, 2);
  assert.deepEqual(resultat.notifications, [
    { emailEnvoye: true, smsEnvoye: true },
    { emailEnvoye: true, smsEnvoye: true },
  ]);
});
