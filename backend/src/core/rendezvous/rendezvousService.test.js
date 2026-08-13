const { test } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const notesDossierRepository = require('../dossier/notesDossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const lieuRepository = require('../lieux/lieuRepository');
const rendezvousService = require('./rendezvousService');

// Le contrôle de date passée intervient avant tout accès DB (voir creerRendezvous) — testable
// sans mock, entité/dossier fictifs compris, puisque l'exécution ne les atteint jamais.
const ENTITE_FACTICE = { id: 1, code: 'accecit' };

// Créneau largement dans le futur, fixe (pas Date.now() + délai) : évite qu'un test devienne
// flaky si l'exécution ralentit autour de la limite "date passée" vérifiée en tout premier dans
// creerRendezvous.
const DATE_HEURE_FUTURE = '2099-01-01T10:00:00.000Z';

// bd factice avec un .transaction(fn) qui exécute simplement fn(bd) (pas de vraie isolation, un
// test unitaire n'en a pas besoin) — creerRendezvous ouvre désormais sa propre transaction quand
// aucune n'est fournie (voir rendezvousService.js, neutralisation de l'ancien rendez-vous actif +
// création du nouveau dans la même transaction).
function creerBdFactice() {
  const bd = {};
  bd.transaction = async (fn) => fn(bd);
  return bd;
}

// Par défaut, aucun rendez-vous actif à neutraliser (0 ligne affectée) — les tests dédiés à la
// neutralisation (plus bas) mockent cette fonction différemment pour vérifier son appel.
function mockerNeutralisationSansEffet(t) {
  return t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => 0);
}

function mockerKnexPourCapacite(t, { nombreDejaPresents }) {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(utilisateurRepository, 'trouverUtilisateurParId', async () => ({
    id: 8,
    role_code: 'formateur',
  }));
  t.mock.method(rendezvousRepository, 'compterRendezvousFormateurAuCreneau', async () => nombreDejaPresents);
  mockerNeutralisationSansEffet(t);
}

test('creerRendezvous rejette une date/heure strictement antérieure à maintenant', async () => {
  const hier = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await assert.rejects(
    () => rendezvousService.creerRendezvous(ENTITE_FACTICE, { dossierId: 1, typeRdv: 'test', dateHeure: hier, formateurId: null }),
    rendezvousService.ErreurDatePassee,
  );
});

test('creerRendezvous rejette une date/heure passée même de quelques secondes seulement', async () => {
  const ilYA10Secondes = new Date(Date.now() - 10 * 1000).toISOString();
  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 1,
        typeRdv: 'test',
        dateHeure: ilYA10Secondes,
        formateurId: null,
      }),
    rendezvousService.ErreurDatePassee,
  );
});

test('creerRendezvous accepte un formateur qui a déjà 0 candidat sur ce créneau', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 0 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 1 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 1 });
  assert.equal(creerMock.mock.calls.length, 1);
});

// Le cœur de l'ajustement métier : un formateur peut désormais évaluer jusqu'à 2 candidats sur
// un même créneau, alors qu'un seul rendez-vous existant bloquait tout auparavant.
test('creerRendezvous accepte un formateur qui a déjà 1 candidat sur ce créneau (encore 1 place)', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 1 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 2 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: 8,
  });

  assert.deepEqual(resultat, { id: 2 });
  assert.equal(creerMock.mock.calls.length, 1);
});

test('creerRendezvous rejette un formateur qui a déjà 2 candidats sur ce créneau (créneau complet)', async (t) => {
  mockerKnexPourCapacite(t, { nombreDejaPresents: 2 });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 3 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: 8,
      }),
    rendezvousService.ErreurCreneauPris,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test('creerRendezvous accepte un lieu actif de l\'entité et transmet son id au repository', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  const trouverLieuMock = t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({
    id: 3,
    entite_id: ENTITE_FACTICE.id,
    code: 'hotel_du_cadran',
    actif: true,
  }));
  mockerNeutralisationSansEffet(t);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (bd, { lieuId }) => ({ id: 4, lieuId }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
    lieuId: 3,
  });

  assert.equal(trouverLieuMock.mock.calls.length, 1);
  assert.deepEqual(trouverLieuMock.mock.calls[0].arguments.slice(1), [ENTITE_FACTICE.id, 3]);
  assert.equal(resultat.lieuId, 3);
  assert.equal(creerMock.mock.calls.length, 1);
});

test('creerRendezvous rejette un lieu introuvable pour cette entité', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => undefined);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 5 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: null,
        lieuId: 999,
      }),
    rendezvousService.ErreurLieuInvalide,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

test('creerRendezvous rejette un lieu désactivé', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(lieuRepository, 'trouverLieuParId', async () => ({ id: 3, actif: false }));
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 6 }));

  await assert.rejects(
    () =>
      rendezvousService.creerRendezvous(ENTITE_FACTICE, {
        dossierId: 42,
        typeRdv: 'test',
        dateHeure: DATE_HEURE_FUTURE,
        formateurId: null,
        lieuId: 3,
      }),
    rendezvousService.ErreurLieuInvalide,
  );
  assert.equal(creerMock.mock.calls.length, 0);
});

// Neutralisation de l'ancien rendez-vous actif (voir rendezvousService.js, STATUT_REMPLACE) —
// corrige la cause racine des doublons observés en base (audit du 2026-08-13, dossier #88,
// rendez-vous 61-65) : jusqu'ici rien ne referme l'ancien rendez-vous lors d'une replanification,
// les deux restaient 'prevu' en parallèle. Ne bloque JAMAIS la création (règle métier validée avec
// Florence) — ces tests vérifient uniquement que l'ancien est neutralisé, jamais qu'il empêche
// quoi que ce soit.
test("creerRendezvous neutralise (STATUT_REMPLACE) l'ancien rendez-vous actif du même dossier+type avant de créer le nouveau, dans la même transaction", async (t) => {
  const bd = creerBdFactice();
  t.mock.method(db, 'obtenirKnex', async () => bd);
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  const appels = [];
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async (trxRecu, args) => {
    appels.push('neutraliser');
    assert.equal(trxRecu, bd, 'doit recevoir la transaction ouverte par creerRendezvous, pas le bd brut');
    assert.deepEqual(args, { dossierId: 42, typeRdv: 'test', statutRemplace: rendezvousService.STATUT_REMPLACE });
    return 1;
  });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (trxRecu) => {
    appels.push('creer');
    assert.equal(trxRecu, bd, 'doit recevoir la même transaction que neutraliserRendezvousActifsDossier');
    return { id: 99 };
  });

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
  });

  assert.deepEqual(resultat, { id: 99 });
  assert.equal(neutraliserMock.mock.calls.length, 1);
  assert.equal(creerMock.mock.calls.length, 1);
  // Neutraliser AVANT de créer — jamais l'inverse (le nouveau ne doit pas se neutraliser lui-même).
  assert.deepEqual(appels, ['neutraliser', 'creer']);
});

test("creerRendezvous réussit sans erreur même quand un rendez-vous actif existe déjà (jamais bloquant, règle métier validée avec Florence)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => creerBdFactice());
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async () => 1);
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async () => ({ id: 100 }));

  const resultat = await rendezvousService.creerRendezvous(ENTITE_FACTICE, {
    dossierId: 42,
    typeRdv: 'test',
    dateHeure: DATE_HEURE_FUTURE,
    formateurId: null,
  });

  assert.deepEqual(resultat, { id: 100 });
  assert.equal(creerMock.mock.calls.length, 1);
});

test("creerRendezvous réutilise la transaction déjà ouverte par l'appelant (bdExistante) au lieu d'en ouvrir une seconde", async (t) => {
  // trx factice SANS méthode .transaction() : si creerRendezvous tentait d'en ouvrir une seconde
  // imbriquée par erreur, l'appel échouerait immédiatement ("trxExistante.transaction is not a
  // function") — l'absence d'erreur prouve qu'elle n'a jamais été invoquée.
  const trxExistante = {};
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42 }));
  const neutraliserMock = t.mock.method(rendezvousRepository, 'neutraliserRendezvousActifsDossier', async (trxRecu) => {
    assert.equal(trxRecu, trxExistante);
    return 1;
  });
  const creerMock = t.mock.method(rendezvousRepository, 'creerRendezvous', async (trxRecu) => {
    assert.equal(trxRecu, trxExistante);
    return { id: 101 };
  });

  const resultat = await rendezvousService.creerRendezvous(
    ENTITE_FACTICE,
    { dossierId: 42, typeRdv: 'test', dateHeure: DATE_HEURE_FUTURE, formateurId: null },
    trxExistante,
  );

  assert.deepEqual(resultat, { id: 101 });
  assert.equal(neutraliserMock.mock.calls.length, 1);
  assert.equal(creerMock.mock.calls.length, 1);
});

// Workflow v4 : replanifier reste possible à tout moment tant que le dossier est test_planifie,
// SAUF dans les 30 minutes précédant le rendez-vous actuel (voir rendezvousService.js, en-tête).
const TRX_FACTICE = { estUnTrx: true };

test("verifierDelaiAvantReplanification ne fait rien si la liste de transitions ne contient pas replanifier_test", async (t) => {
  const trouverDossierMock = t.mock.method(dossierRepository, 'trouverDossierParId', async () => {
    throw new Error('ne devrait jamais être appelé');
  });

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'planifier_test', commentaire: 'Test planifié.' }],
    TRX_FACTICE,
  );

  assert.equal(trouverDossierMock.mock.calls.length, 0);
});

test("verifierDelaiAvantReplanification ne fait rien si le dossier n'est plus test_planifie (replanification depuis test_non_realise/invalide)", async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_non_realise' }));
  const trouverActifMock = t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => {
    throw new Error('ne devrait jamais être appelé');
  });

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );

  assert.equal(trouverActifMock.mock.calls.length, 0);
});

test('verifierDelaiAvantReplanification ne fait rien si le dossier est test_planifie mais sans rendez-vous actif', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => undefined);

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );
  // Ne lève pas — rien à protéger.
});

test('verifierDelaiAvantReplanification autorise la replanification si le rendez-vous actuel est encore à plus de 30 minutes', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const dansUneHeure = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: dansUneHeure }));

  await rendezvousService.verifierDelaiAvantReplanification(
    ENTITE_FACTICE,
    42,
    [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
    TRX_FACTICE,
  );
});

test('verifierDelaiAvantReplanification rejette si le rendez-vous actuel est dans moins de 30 minutes', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const dansQuinzeMinutes = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: dansQuinzeMinutes }));

  await assert.rejects(
    () =>
      rendezvousService.verifierDelaiAvantReplanification(
        ENTITE_FACTICE,
        42,
        [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
        TRX_FACTICE,
      ),
    rendezvousService.ErreurReplanificationTropTardive,
  );
});

test('verifierDelaiAvantReplanification rejette si le rendez-vous actuel est déjà passé', async (t) => {
  t.mock.method(dossierRepository, 'trouverDossierParId', async () => ({ id: 42, statut_code: 'test_planifie' }));
  const ilYADixMinutes = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  t.mock.method(rendezvousRepository, 'trouverRendezvousTestActifDossier', async () => ({ date_heure: ilYADixMinutes }));

  await assert.rejects(
    () =>
      rendezvousService.verifierDelaiAvantReplanification(
        ENTITE_FACTICE,
        42,
        [{ codeAction: 'replanifier_test', commentaire: 'Replanifié.' }],
        TRX_FACTICE,
      ),
    rendezvousService.ErreurReplanificationTropTardive,
  );
});

// listerHistoriqueRendezvousDossiers / catégorisation (page Planification, bouton "Voir
// l'historique des rendez-vous sélectionnés") — voir rendezvousService.js pour le raisonnement
// complet (rendezvous.statut ne porte aucune valeur "honoré", déduite de l'existence d'une
// évaluation liée ; "Replanifié" déduit de la position dans l'historique du dossier, pas d'une
// colonne dédiée). Renvoie désormais { rendezvous, notes } (décision utilisateur du 2026-08-13,
// ajout des notes/motif/commentaire d'évaluation au panneau) : notes_dossier n'a pas de colonne
// rendezvous_id, ces notes sont donc renvoyées à part, jamais rattachées à une ligne `rendezvous`
// précise (voir notesDossierRepository.listerNotesParDossiers).
const DATE_FUTURE = '2099-06-15T09:00:00.000Z';
const DATE_PASSEE = '2020-01-01T09:00:00.000Z';

// Mock par défaut : aucune note (voir tests dédiés plus bas pour le cas avec notes) — la plupart
// des tests de catégorisation ci-dessous ne portent pas sur les notes, ce mock leur évite de
// planter sur l'appel Promise.all à notesDossierRepository.listerNotesParDossiers.
function mockerNotesVides(t) {
  t.mock.method(notesDossierRepository, 'listerNotesParDossiers', async () => []);
}

test("listerHistoriqueRendezvousDossiers renvoie { rendezvous: [], notes: [] } sans appeler les repositories si dossierIds est vide", async (t) => {
  const repoRendezvousMock = t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => {
    throw new Error('ne doit pas être appelé');
  });
  const repoNotesMock = t.mock.method(notesDossierRepository, 'listerNotesParDossiers', async () => {
    throw new Error('ne doit pas être appelé');
  });

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, []);

  assert.deepEqual(resultat, { rendezvous: [], notes: [] });
  assert.equal(repoRendezvousMock.mock.calls.length, 0);
  assert.equal(repoNotesMock.mock.calls.length, 0);
});

test('listerHistoriqueRendezvousDossiers catégorise Honoré dès qu\'une évaluation existe, même si le statut brut reste "prevu"', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 88, date_heure: DATE_PASSEE, statut: 'prevu', evaluation_id: 501, evaluation_resultat: 'valide' },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [88]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.HONORE);
});

test("listerHistoriqueRendezvousDossiers catégorise Manqué/Annulé directement depuis rendezvous.statut", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 74, date_heure: DATE_PASSEE, statut: 'absent', evaluation_id: null },
    { id: 2, dossier_id: 74, date_heure: DATE_PASSEE, statut: 'annule', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [74]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.MANQUE);
  assert.equal(resultat.rendezvous[1].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.ANNULE);
});

test('listerHistoriqueRendezvousDossiers catégorise À venir un rendez-vous "prevu" encore actif dont la date est future', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 1, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [1]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_VENIR);
});

test('listerHistoriqueRendezvousDossiers catégorise À traiter un rendez-vous "confirme" toujours actif dont la date est déjà passée, sans évaluation ni statut absent/annule', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 2, dossier_id: 2, date_heure: DATE_PASSEE, statut: 'confirme', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [2]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_TRAITER);
});

test('listerHistoriqueRendezvousDossiers catégorise Replanifié un rendez-vous "prevu" plus ancien qu\'un autre rendez-vous du même dossier (réplanification jamais actée sur l\'ancien, voir dossiers #74/#88)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 88, date_heure: '2026-08-01T09:00:00.000Z', statut: 'prevu', evaluation_id: null },
    { id: 2, dossier_id: 88, date_heure: '2026-08-10T09:00:00.000Z', statut: 'prevu', evaluation_id: null },
    { id: 3, dossier_id: 88, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [88]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.REPLANIFIE);
  assert.equal(resultat.rendezvous[1].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.REPLANIFIE);
  assert.equal(resultat.rendezvous[2].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_VENIR);
});

test("listerHistoriqueRendezvousDossiers calcule le rendez-vous actif indépendamment pour chaque dossier (le 'plus récent' d'un dossier ne doit pas influencer un autre)", async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    // Dossier 1 : un seul rendez-vous, passé, toujours actif -> À traiter (pas Replanifié : rien
    // d'autre n'existe pour ce dossier).
    { id: 1, dossier_id: 1, date_heure: DATE_PASSEE, statut: 'prevu', evaluation_id: null },
    // Dossier 2 : un seul rendez-vous, futur -> À venir.
    { id: 2, dossier_id: 2, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [1, 2]);

  assert.equal(resultat.rendezvous[0].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_TRAITER);
  assert.equal(resultat.rendezvous[1].statutCategorise, rendezvousService.CATEGORIES_STATUT_HISTORIQUE.A_VENIR);
});

test('listerHistoriqueRendezvousDossiers transmet le motif (annulé/absent) et le commentaire d\'évaluation (honoré) portés par chaque ligne de rendez-vous, inchangés', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  mockerNotesVides(t);
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    {
      id: 1,
      dossier_id: 74,
      date_heure: DATE_PASSEE,
      statut: 'annule',
      evaluation_id: null,
      motif_code: 'absence_non_justifiee',
      motif_libelle: 'Absence non justifiée',
    },
    {
      id: 2,
      dossier_id: 74,
      date_heure: DATE_PASSEE,
      statut: 'prevu',
      evaluation_id: 501,
      evaluation_resultat: 'valide',
      evaluation_commentaire: 'Bon contact candidat, ponctuel.',
    },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [74]);

  assert.equal(resultat.rendezvous[0].motif_libelle, 'Absence non justifiée');
  assert.equal(resultat.rendezvous[1].evaluation_commentaire, 'Bon contact candidat, ponctuel.');
});

test('listerHistoriqueRendezvousDossiers renvoie les notes de dossier telles que fournies par le repository, sans les rattacher à un rendez-vous', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(rendezvousRepository, 'listerHistoriqueRendezvousParDossiers', async () => [
    { id: 1, dossier_id: 88, date_heure: DATE_FUTURE, statut: 'prevu', evaluation_id: null },
  ]);
  const notesMock = t.mock.method(notesDossierRepository, 'listerNotesParDossiers', async () => [
    { id: 10, dossier_id: 88, contenu: 'Candidat très motivé.', date_creation: DATE_PASSEE, auteur_prenom: 'Jeanne', auteur_nom: 'Dupont' },
  ]);

  const resultat = await rendezvousService.listerHistoriqueRendezvousDossiers(ENTITE_FACTICE, [88]);

  assert.equal(notesMock.mock.calls.length, 1);
  assert.deepEqual(notesMock.mock.calls[0].arguments.slice(1), [ENTITE_FACTICE.id, [88]]);
  assert.deepEqual(resultat.notes, [
    { id: 10, dossier_id: 88, contenu: 'Candidat très motivé.', date_creation: DATE_PASSEE, auteur_prenom: 'Jeanne', auteur_nom: 'Dupont' },
  ]);
});
