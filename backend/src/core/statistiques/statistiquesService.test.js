const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const statistiquesRepository = require('./statistiquesRepository');
const dossierRepository = require('../dossier/dossierRepository');
const statistiquesService = require('./statistiquesService');

const ENTITE_ACCECIT = { id: 1, code: 'accecit' };

function mockerKnex(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
}

// Valeurs par défaut cohérentes entre elles (10 inscrits, 4 convertis, etc.) — chaque test ne
// surcharge que ce qui l'intéresse, même patron que relanceService.test.js (mockerKnex).
function mockerRepository(t, overrides = {}) {
  const valeursParDefaut = {
    compterInscrits: async () => ({ total: '10' }),
    compterEnvoyesEnTest: async () => ({ total: '6' }),
    compterVerdicts: async () => [
      { resultat_global: 'valide', total: '4' },
      { resultat_global: 'invalide', total: '2' },
    ],
    compterOrientations: async () => [
      { orientation: 'envoi_formation', total: '3' },
      { orientation: 'pret_embauche', total: '1' },
    ],
    compterDossiersConvertis: async () => ({ total: '4' }),
    listerRepartitionParEvaluation: async () => [{ poste_code: 'cafetier', nb_evaluations: '3' }],
    listerRepartitionParOccurrence: async () => [{ poste_code: 'cafetier', nb_occurrences: '4' }],
    compterEvaluationsSansPoste: async () => ({ total: '1' }),
    delaiInscriptionVersTestPlanifie: async () => ({ moyenne_jours: '5.234', nb_dossiers: '6' }),
    delaiTestVersVerdict: async () => ({ moyenne_jours: null, nb_dossiers: '0' }),
    delaiFormation: async () => ({ moyenne_jours: null, nb_dossiers: '0' }),
    // Effectifs par statut (audit tableau de bord 2026-08-31) — compterParStatut appelée 3 fois
    // (une par code de CODES_STATUTS_EFFECTIF_COURANT_ACCECIT, statuts terminaux), et
    // compterParHistoriqueStatut 1 fois (test_realise, statut transitoire, corrigé en 3e passe —
    // voir son commentaire dans statistiquesService.js). Valeur par défaut identique pour les
    // appels multiples tant qu'un test ne la surcharge pas explicitement (voir le test dédié plus
    // bas, qui distingue les codes par argument). Indispensable, pas juste une bonne pratique : sans
    // ces mocks, l'appel tombe sur la VRAIE implémentation du repository et tente une connexion
    // réelle (obtenirKnex n'est PAS intercepté par mockerKnex ici — `const { obtenirKnex } =
    // require(...)` capture la fonction par valeur à l'import, `t.mock.method(db, 'obtenirKnex', ...)`
    // ne peut donc pas la remplacer rétroactivement), ce qui a fait suspendre indéfiniment
    // `node --test` le temps de l'écrire (constaté en implémentant le correctif précédent) —
    // exactement pourquoi chaque AUTRE appel de repository utilisé par obtenirIndicateursKpi a déjà
    // son propre mock par défaut ci-dessus.
    compterParStatut: async () => ({ total: '0' }),
    compterParHistoriqueStatut: async () => ({ total: '0' }),
  };
  const valeurs = { ...valeursParDefaut, ...overrides };
  for (const [methode, implementation] of Object.entries(valeurs)) {
    t.mock.method(statistiquesRepository, methode, implementation);
  }
}

test('obtenirIndicateursKpi assemble les 7 statistiques, avec le taux de conversion et la catégorie Non spécifié', async (t) => {
  mockerKnex(t);
  mockerRepository(t);

  const resultat = await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
  });

  assert.equal(resultat.inscrits.total, 10);
  assert.equal(resultat.envoyesEnTest.total, 6);
  assert.deepEqual(resultat.verdicts, { valide: 4, invalide: 2 });
  assert.deepEqual(resultat.orientations, { envoi_formation: 3, pret_embauche: 1 });
  assert.equal(resultat.conversion.numerateur, 4);
  assert.equal(resultat.conversion.denominateur, 10);
  assert.equal(resultat.conversion.taux, 0.4);

  const posteNonSpecifie = resultat.repartitionParPoste.parEvaluation.find((ligne) => ligne.posteCode === null);
  assert.ok(posteNonSpecifie, 'la catégorie "Non spécifié" doit apparaître, pas être exclue silencieusement');
  assert.equal(posteNonSpecifie.nbEvaluations, 1);
  const posteCafetier = resultat.repartitionParPoste.parEvaluation.find((ligne) => ligne.posteCode === 'cafetier');
  assert.equal(posteCafetier.nbEvaluations, 3);
  assert.equal(resultat.repartitionParPoste.parOccurrence[0].nbOccurrences, 4);

  assert.equal(resultat.delaisMoyens.inscriptionVersTestPlanifie.moyenneJours, 5.2);
  assert.equal(resultat.delaisMoyens.inscriptionVersTestPlanifie.nbDossiers, 6);
  assert.equal(resultat.delaisMoyens.testVersVerdict.moyenneJours, null);
  assert.equal(resultat.delaisMoyens.formation.moyenneJours, null);
});

// Carte "Délai moyen formation" (introduite le 2026-09-01, audit tableau de bord 2026-08-31,
// point #5, en remplacement de "Délai moyen test → verdict" sur le dashboard) — assemblée à partir
// de statistiquesRepository.delaiFormation, même patron que delaiInscriptionVersTestPlanifie/
// delaiTestVersVerdict ci-dessus.
test('obtenirIndicateursKpi assemble delaisMoyens.formation à partir de delaiFormation', async (t) => {
  mockerKnex(t);
  mockerRepository(t, { delaiFormation: async () => ({ moyenne_jours: '12.34', nb_dossiers: '3' }) });

  const resultat = await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
  });

  assert.equal(resultat.delaisMoyens.formation.moyenneJours, 12.3);
  assert.equal(resultat.delaisMoyens.formation.nbDossiers, 3);
});

// Cartes "Effectifs par statut" (audit tableau de bord 2026-08-31, décision utilisateur) —
// compterParStatut appelée une fois par code de CODES_STATUTS_EFFECTIF_ACCECIT (4 appels),
// résultat assemblé sous `effectifsParStatut` avec CE code de statut comme clé — distingue les 4
// appels par leur 3e argument (statutCode), même patron que le test "transmet typePoste/poste"
// plus bas pour un seul appel.
// Corrigé (audit tableau de bord 2026-08-31, 3e passe) : test_realise (statut TRANSITOIRE) passe
// désormais par compterParHistoriqueStatut, distinct des 3 autres (statuts TERMINAUX) qui restent
// sur compterParStatut (statut courant) — voir CODES_STATUTS_EFFECTIF_COURANT_ACCECIT/
// CODE_STATUT_EFFECTIF_HISTORIQUE_ACCECIT, statistiquesService.js.
test('obtenirIndicateursKpi assemble effectifsParStatut : test_realise via compterParHistoriqueStatut, les 3 autres via compterParStatut', async (t) => {
  mockerKnex(t);
  const VALEURS_STATUT_COURANT = {
    valide_pret_embauche: '9',
    formation_non_validee: '2',
    embauche: '1',
  };
  mockerRepository(t, {
    compterParHistoriqueStatut: async (bd, entiteId, statutCode) => {
      assert.equal(statutCode, 'test_realise', 'compterParHistoriqueStatut ne doit être appelée que pour test_realise');
      return { total: '8' };
    },
    compterParStatut: async (bd, entiteId, statutCode) => {
      assert.notEqual(statutCode, 'test_realise', 'test_realise ne doit plus passer par compterParStatut (statut courant)');
      return { total: VALEURS_STATUT_COURANT[statutCode] ?? '0' };
    },
  });

  const resultat = await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
  });

  assert.deepEqual(resultat.effectifsParStatut, {
    test_realise: 8,
    valide_pret_embauche: 9,
    formation_non_validee: 2,
    embauche: 1,
  });
});

test("obtenirIndicateursKpi renvoie un taux de conversion null plutôt qu'une division par zéro si aucun inscrit sur la période", async (t) => {
  mockerKnex(t);
  mockerRepository(t, {
    compterInscrits: async () => ({ total: '0' }),
    compterDossiersConvertis: async () => ({ total: '0' }),
  });

  const resultat = await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
  });

  assert.equal(resultat.conversion.taux, null);
  assert.equal(resultat.conversion.numerateur, 0);
  assert.equal(resultat.conversion.denominateur, 0);
});

test("obtenirIndicateursKpi n'ajoute pas la catégorie Non spécifié si aucune évaluation n'en relève", async (t) => {
  mockerKnex(t);
  mockerRepository(t, { compterEvaluationsSansPoste: async () => ({ total: '0' }) });

  const resultat = await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
  });

  const posteNonSpecifie = resultat.repartitionParPoste.parEvaluation.find((ligne) => ligne.posteCode === null);
  assert.equal(posteNonSpecifie, undefined);
});

test('obtenirIndicateursKpi calcule une borne de fin de période exclusive (dateFin + 1 jour)', async (t) => {
  mockerKnex(t);
  mockerRepository(t);
  const appelInscrits = t.mock.method(statistiquesRepository, 'compterInscrits', async () => ({ total: '10' }));

  await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, { dateDebut: '2026-07-01', dateFin: '2026-07-31' });

  const filtresRecus = appelInscrits.mock.calls[0].arguments[2];
  assert.equal(filtresRecus.debut.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(filtresRecus.finExclusive.toISOString(), '2026-08-01T00:00:00.000Z');
});

test('obtenirIndicateursKpi transmet typePoste/poste tels quels à chaque requête du repository', async (t) => {
  mockerKnex(t);
  mockerRepository(t);
  const appelInscrits = t.mock.method(statistiquesRepository, 'compterInscrits', async () => ({ total: '10' }));

  await statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    typePoste: 'hotel',
    poste: 'cafetier',
  });

  const filtresRecus = appelInscrits.mock.calls[0].arguments[2];
  assert.equal(filtresRecus.typePoste, 'hotel');
  assert.equal(filtresRecus.poste, 'cafetier');
});

// validerCoherencePosteTypePoste (statistiquesService.js) : un poste Tertiaire (bureau) avec
// typePoste="hotel" est incohérent — sans cette validation, statistiquesRepository.
// filtrerPosteDossier ignorerait typePoste silencieusement ("poste prime"), donnant des résultats
// trompeurs plutôt qu'une erreur claire (voir bug /tableau-de-bord/indicateurs, filtre Entité +
// Poste, 2026-08-10).
test("obtenirIndicateursKpi rejette une combinaison poste/typePoste incohérente (poste Tertiaire avec typePoste 'hotel')", async (t) => {
  mockerKnex(t);
  mockerRepository(t);

  await assert.rejects(
    () =>
      statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
        dateDebut: '2026-07-01',
        dateFin: '2026-07-31',
        typePoste: 'hotel',
        poste: 'nettoyage',
      }),
    (erreur) => erreur instanceof statistiquesService.ErreurStatistiquesInvalide,
  );
});

test('obtenirIndicateursKpi accepte poste seul, typePoste seul, et une combinaison cohérente des deux', async (t) => {
  mockerKnex(t);
  mockerRepository(t);

  await assert.doesNotReject(() =>
    statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
      dateDebut: '2026-07-01',
      dateFin: '2026-07-31',
      poste: 'nettoyage',
    }),
  );
  await assert.doesNotReject(() =>
    statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
      dateDebut: '2026-07-01',
      dateFin: '2026-07-31',
      typePoste: 'bureau',
    }),
  );
  await assert.doesNotReject(() =>
    statistiquesService.obtenirIndicateursKpi(ENTITE_ACCECIT, {
      dateDebut: '2026-07-01',
      dateFin: '2026-07-31',
      typePoste: 'bureau',
      poste: 'nettoyage',
    }),
  );
});

test('listerDossiersParIndicateurs rejette la même combinaison poste/typePoste incohérente', async (t) => {
  mockerKnex(t);
  t.mock.method(dossierRepository, 'listerDossiersParIds', async () => []);

  await assert.rejects(
    () =>
      statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
        dateDebut: '2026-07-01',
        dateFin: '2026-07-31',
        typePoste: 'hotel',
        poste: 'nettoyage',
        indicateurs: ['inscrits'],
      }),
    (erreur) => erreur instanceof statistiquesService.ErreurStatistiquesInvalide,
  );
});

// ET strict (voir statistiquesService.js) : le dossier #2, qui ne satisfait que "inscrits" et pas
// "envoyes_en_test", doit désormais être EXCLU du résultat — seul le dossier #1 (les deux à la
// fois) ressort. Avant le passage à l'ET strict, les deux dossiers apparaissaient (union) ; ce
// test vérifie explicitement le changement de comportement.
test('listerDossiersParIndicateurs ne retient que les dossiers satisfaisant TOUS les indicateurs demandés (ET strict)', async (t) => {
  mockerKnex(t);
  t.mock.method(statistiquesRepository, 'listerInscrits', async () => [
    { dossier_id: 1, date_cle: new Date('2026-07-05') },
    { dossier_id: 2, date_cle: new Date('2026-07-06') },
  ]);
  t.mock.method(statistiquesRepository, 'listerEnvoyesEnTest', async () => [
    { dossier_id: 1, date_cle: new Date('2026-07-10') },
  ]);
  const appelListerDossiers = t.mock.method(dossierRepository, 'listerDossiersParIds', async (bd, entiteId, ids) => {
    assert.deepEqual([...ids], [1], 'seul le dossier #1 (satisfait aux deux indicateurs) doit être demandé');
    return [
      { id: 1, date_creation: '2026-07-05', date_maj: '2026-07-10', candidat_nom: 'Martin', donnees_disponibilites: null },
    ];
  });

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['inscrits', 'envoyes_en_test'],
  });

  assert.equal(appelListerDossiers.mock.calls.length, 1);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
  assert.deepEqual(
    resultat[0].indicateurs.map((i) => i.code),
    ['inscrits', 'envoyes_en_test'],
  );
});

// Conséquence acceptée de l'ET strict (décision utilisateur, 2026-08-07) : deux indicateurs
// mutuellement exclusifs (un dossier n'a qu'un seul verdict par test, jamais les deux) donnent un
// résultat vide — pas une erreur, le comportement normal attendu.
test('listerDossiersParIndicateurs renvoie un résultat vide pour deux indicateurs mutuellement exclusifs (verdict_valide + verdict_invalide)', async (t) => {
  mockerKnex(t);
  t.mock.method(statistiquesRepository, 'listerVerdicts', async (bd, entiteId, filtres, resultatGlobal) =>
    resultatGlobal === 'valide'
      ? [{ dossier_id: 1, date_cle: new Date('2026-07-05') }]
      : [{ dossier_id: 2, date_cle: new Date('2026-07-06') }],
  );
  const appelListerDossiers = t.mock.method(dossierRepository, 'listerDossiersParIds', async () => []);

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['verdict_valide', 'verdict_invalide'],
  });

  assert.deepEqual(resultat, []);
  assert.deepEqual(appelListerDossiers.mock.calls[0].arguments[2], []);
});

// À l'inverse, deux indicateurs "poste" compatibles (une même évaluation peut porter plusieurs
// postes, voir evaluations_postes) donnent bien un résultat non vide dès qu'un dossier satisfait
// les deux — l'ET strict n'empêche pas un résultat, il exige juste que TOUS les critères
// choisis soient réunis sur le même dossier (dossier #2, qui ne matche que "cafetier", est exclu).
test('listerDossiersParIndicateurs retient un dossier qui satisfait deux indicateurs "poste" compatibles à la fois', async (t) => {
  mockerKnex(t);
  t.mock.method(statistiquesRepository, 'listerRepartitionParPosteDossiers', async (bd, entiteId, filtres, posteCode) =>
    posteCode === 'cafetier'
      ? [
          { dossier_id: 1, date_cle: new Date('2026-07-05') },
          { dossier_id: 2, date_cle: new Date('2026-07-06') },
        ]
      : [{ dossier_id: 1, date_cle: new Date('2026-07-05') }],
  );
  const appelListerDossiers = t.mock.method(dossierRepository, 'listerDossiersParIds', async (bd, entiteId, ids) => {
    assert.deepEqual([...ids], [1]);
    return [
      { id: 1, date_creation: '2026-07-05', date_maj: '2026-07-05', candidat_nom: 'Martin', donnees_disponibilites: null },
    ];
  });

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['poste:cafetier', 'poste:equipier'],
  });

  assert.equal(appelListerDossiers.mock.calls.length, 1);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
});

// Un code "statut" et un code "poste" se combinent en ET comme deux codes quelconques — plus de
// distinction de catégorie depuis le passage à l'ET strict, cette combinaison n'est plus un cas
// particulier.
test('listerDossiersParIndicateurs combine en ET deux indicateurs de nature différente (statut × poste)', async (t) => {
  mockerKnex(t);
  t.mock.method(statistiquesRepository, 'listerEnvoyesEnTest', async () => [
    { dossier_id: 1, date_cle: new Date('2026-07-05') },
    { dossier_id: 2, date_cle: new Date('2026-07-06') },
  ]);
  t.mock.method(statistiquesRepository, 'listerRepartitionParPosteDossiers', async () => [
    { dossier_id: 1, date_cle: new Date('2026-07-08') },
  ]);
  const appelListerDossiers = t.mock.method(dossierRepository, 'listerDossiersParIds', async (bd, entiteId, ids) => {
    assert.deepEqual([...ids], [1], "seul le dossier #1 (présent dans les deux catégories) doit être demandé à listerDossiersParIds");
    return [
      { id: 1, date_creation: '2026-07-05', date_maj: '2026-07-08', candidat_nom: 'Martin', donnees_disponibilites: null },
    ];
  });

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['envoyes_en_test', 'poste:cafetier'],
  });

  assert.equal(appelListerDossiers.mock.calls.length, 1);
  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].id, 1);
  assert.deepEqual(
    resultat[0].indicateurs.map((i) => i.code),
    ['envoyes_en_test', 'poste:cafetier'],
    'le dossier retenu doit afficher les deux badges, chaque code étant individuellement satisfait',
  );
});

// Cas limite de l'intersection : un indicateur sélectionné mais dont AUCUN dossier ne correspond
// vide déjà le résultat final à ce stade — comportement naturel d'un ET strict (voir
// statistiquesService.js), pas un cas à traiter séparément.
test('listerDossiersParIndicateurs renvoie un résultat vide si un des indicateurs sélectionnés ne matche aucun dossier', async (t) => {
  mockerKnex(t);
  t.mock.method(statistiquesRepository, 'listerEnvoyesEnTest', async () => [
    { dossier_id: 1, date_cle: new Date('2026-07-05') },
  ]);
  t.mock.method(statistiquesRepository, 'listerRepartitionParPosteDossiers', async () => []);
  const appelListerDossiers = t.mock.method(dossierRepository, 'listerDossiersParIds', async () => []);

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['envoyes_en_test', 'poste:cafetier'],
  });

  assert.deepEqual(resultat, []);
  assert.deepEqual(appelListerDossiers.mock.calls[0].arguments[2], []);
});

test('listerDossiersParIndicateurs route "delai_formation" vers listerDelaiFormation', async (t) => {
  mockerKnex(t);
  const appel = t.mock.method(statistiquesRepository, 'listerDelaiFormation', async () => [
    { dossier_id: 3, date_cle: new Date('2026-07-22') },
  ]);
  t.mock.method(dossierRepository, 'listerDossiersParIds', async () => [
    { id: 3, date_creation: '2026-07-10', date_maj: '2026-07-22', candidat_nom: 'Dupont', donnees_disponibilites: null },
  ]);

  await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['delai_formation'],
  });

  assert.equal(appel.mock.calls.length, 1);
});

test('listerDossiersParIndicateurs rejette un code de poste inconnu', async (t) => {
  mockerKnex(t);
  await assert.rejects(
    () =>
      statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
        dateDebut: '2026-07-01',
        dateFin: '2026-07-31',
        indicateurs: ['poste:code_inexistant'],
      }),
    statistiquesService.ErreurStatistiquesInvalide,
  );
});

test('listerDossiersParIndicateurs rejette un code d’indicateur inconnu', async (t) => {
  mockerKnex(t);
  await assert.rejects(
    () =>
      statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
        dateDebut: '2026-07-01',
        dateFin: '2026-07-31',
        indicateurs: ['un_code_qui_nexiste_pas'],
      }),
    statistiquesService.ErreurStatistiquesInvalide,
  );
});

test('listerDossiersParIndicateurs route un code "poste:<code>" vers listerRepartitionParPosteDossiers', async (t) => {
  mockerKnex(t);
  const appel = t.mock.method(statistiquesRepository, 'listerRepartitionParPosteDossiers', async () => [
    { dossier_id: 5, date_cle: new Date('2026-07-12') },
  ]);
  t.mock.method(dossierRepository, 'listerDossiersParIds', async () => [
    { id: 5, date_creation: '2026-07-12', date_maj: '2026-07-12', candidat_nom: 'Leroy', donnees_disponibilites: null },
  ]);

  await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['poste:cafetier'],
  });

  assert.equal(appel.mock.calls[0].arguments[3], 'cafetier');
});

// Cartes "Effectifs par statut" (audit tableau de bord 2026-08-31, décision utilisateur) — code
// GÉNÉRIQUE 'statut:<code>' (PREFIXE_STATUT), symétrique du test 'poste:<code>' ci-dessus : route
// vers listerParStatut avec le code de statut décodé, pour N'IMPORTE QUEL code (pas seulement les
// 4 codes affichés en carte, voir CODES_STATUTS_EFFECTIF_ACCECIT).
test('listerDossiersParIndicateurs route un code "statut:<code>" vers listerParStatut', async (t) => {
  mockerKnex(t);
  const appel = t.mock.method(statistiquesRepository, 'listerParStatut', async () => [
    { dossier_id: 9, date_cle: new Date('2026-07-20') },
  ]);
  t.mock.method(dossierRepository, 'listerDossiersParIds', async () => [
    { id: 9, date_creation: '2026-07-20', date_maj: '2026-07-20', candidat_nom: 'Bernard', donnees_disponibilites: null },
  ]);

  await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['statut:embauche'],
  });

  assert.equal(appel.mock.calls[0].arguments[2], 'embauche');
});

// Exception 'statut:test_realise' (audit tableau de bord 2026-08-31, 3e passe) — la LISTE de
// dossiers doit suivre la même logique HISTORIQUE que le CHIFFRE de sa carte
// (compterParHistoriqueStatut, voir obtenirIndicateursKpi), jamais listerParStatut (statut
// courant) comme les 3 autres codes 'statut:<code>' du dashboard.
test('listerDossiersParIndicateurs route "statut:test_realise" vers listerParHistoriqueStatut, pas listerParStatut', async (t) => {
  mockerKnex(t);
  const appelHistorique = t.mock.method(statistiquesRepository, 'listerParHistoriqueStatut', async () => [
    { dossier_id: 12, date_cle: new Date('2026-07-18') },
  ]);
  const appelStatutCourant = t.mock.method(statistiquesRepository, 'listerParStatut', async () => []);
  t.mock.method(dossierRepository, 'listerDossiersParIds', async () => [
    { id: 12, date_creation: '2026-07-18', date_maj: '2026-07-18', candidat_nom: 'Girard', donnees_disponibilites: null },
  ]);

  await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['statut:test_realise'],
  });

  assert.equal(appelHistorique.mock.calls.length, 1);
  assert.equal(appelHistorique.mock.calls[0].arguments[2], 'test_realise');
  assert.equal(appelStatutCourant.mock.calls.length, 0);
});

// Barre "Non spécifié" du graphique de répartition par poste — code statique 'poste_non_specifie'
// (pas 'poste:<code>', voir CODES_INDICATEURS_STATIQUES) : doit router vers
// listerEvaluationsSansPosteDossiers, pas être rejeté comme un code inconnu.
test("listerDossiersParIndicateurs route 'poste_non_specifie' vers listerEvaluationsSansPosteDossiers", async (t) => {
  mockerKnex(t);
  const appel = t.mock.method(statistiquesRepository, 'listerEvaluationsSansPosteDossiers', async () => [
    { dossier_id: 7, date_cle: new Date('2026-07-15') },
  ]);
  t.mock.method(dossierRepository, 'listerDossiersParIds', async () => [
    { id: 7, date_creation: '2026-07-15', date_maj: '2026-07-15', candidat_nom: 'Petit', donnees_disponibilites: null },
  ]);

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['poste_non_specifie'],
  });

  assert.equal(appel.mock.calls.length, 1);
  assert.deepEqual(
    resultat[0].indicateurs.map((i) => i.code),
    ['poste_non_specifie'],
  );
});

test('listerDossiersParIndicateurs renvoie un tableau vide sans appeler listerDossiersParIds si aucun dossier ne correspond', async (t) => {
  mockerKnex(t);
  t.mock.method(statistiquesRepository, 'listerInscrits', async () => []);
  const appelListerDossiers = t.mock.method(dossierRepository, 'listerDossiersParIds', async () => []);

  const resultat = await statistiquesService.listerDossiersParIndicateurs(ENTITE_ACCECIT, {
    dateDebut: '2026-07-01',
    dateFin: '2026-07-31',
    indicateurs: ['inscrits'],
  });

  assert.deepEqual(resultat, []);
  assert.deepEqual(appelListerDossiers.mock.calls[0].arguments[2], []);
});
