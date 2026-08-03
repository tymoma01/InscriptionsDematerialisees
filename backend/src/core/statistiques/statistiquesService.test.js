const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const statistiquesRepository = require('./statistiquesRepository');
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
