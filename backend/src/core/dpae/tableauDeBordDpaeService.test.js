const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const tableauDeBordDpaeService = require('./tableauDeBordDpaeService');
const tableauDeBordDpaeRepository = require('./tableauDeBordDpaeRepository');

// Tests unitaires (sans base) du « Tableau de bord DPAE » : dates en heure de Paris, période par
// défaut, granularité, assemblage des indicateurs, et forme du SQL commun. Les agrégats SQL
// eux-mêmes sont vérifiés sur la vraie base DEV par scripts/testTableauDeBordDpae.js.
const { jourParis, resoudreFiltres, granularitePeriode, construireTableauDeBord, ErreurFiltresTableauDeBord } = tableauDeBordDpaeService;

test("jourParis : entre minuit et 2 h à Paris, c'est déjà le jour suivant (jamais la veille UTC)", () => {
  assert.equal(jourParis(new Date('2026-09-29T22:30:00Z')), '2026-09-30'); // 0 h 30 à Paris (été)
  assert.equal(jourParis(new Date('2026-12-31T23:30:00Z')), '2027-01-01'); // 0 h 30 à Paris (hiver)
  assert.equal(jourParis(new Date('2026-09-30T21:59:00Z')), '2026-09-30'); // 23 h 59 à Paris
});

test('resoudreFiltres : période par défaut = les 30 derniers jours, aujourd’hui inclus (heure de Paris)', () => {
  assert.deepEqual(resoudreFiltres({}, new Date('2026-09-29T22:30:00Z')), {
    debut: '2026-09-01',
    fin: '2026-09-30',
    siteId: null,
    typeContrat: null,
    statut: null,
  });
});

test('resoudreFiltres : filtres fournis conservés ; début postérieur à la fin -> erreur explicite', () => {
  assert.deepEqual(resoudreFiltres({ debut: '2026-01-01', fin: '2026-02-01', siteId: 3, typeContrat: 'cdd', statut: 'envoyee' }), {
    debut: '2026-01-01',
    fin: '2026-02-01',
    siteId: 3,
    typeContrat: 'cdd',
    statut: 'envoyee',
  });
  assert.throws(() => resoudreFiltres({ debut: '2026-03-01', fin: '2026-02-01' }), ErreurFiltresTableauDeBord);
});

test('granularitePeriode : semaine jusqu’à 3 mois de période, mois au-delà', () => {
  assert.equal(granularitePeriode('2026-09-01', '2026-09-30'), 'semaine');
  assert.equal(granularitePeriode('2026-07-01', '2026-10-01'), 'semaine'); // exactement 3 mois
  assert.equal(granularitePeriode('2026-06-30', '2026-10-01'), 'mois');
});

const BRUTS_VIDES = {
  premierJourProche: [],
  aTraiterPlus24h: [],
  valideesEnRetard: [],
  parStatut: [],
  delais: { nombre_traitees: 0, moyen_heures: null, median_heures: null },
  evolution: [],
  contrats: [],
  motifsCdd: [],
  topSites: [],
  nonReferencees: { nombre: 0, ids: [] },
  postes: [],
  demandeurs: [],
  dejaEmploye: [],
  finsDeCdd: [],
};

test('construireTableauDeBord : sans aucune décision, taux de rejet null (jamais un 0 % trompeur) et compteurs à zéro', () => {
  const t = construireTableauDeBord({ filtres: {}, granularite: 'semaine', optionsSites: [], liens: [], bruts: BRUTS_VIDES });
  assert.equal(t.activite.total, 0);
  assert.equal(t.activite.tauxRejet, null);
  assert.deepEqual(t.activite.parStatut, { a_valider_planning: 0, renvoyee_inspecteur: 0, envoyee: 0, en_attente: 0, validee: 0, rejetee: 0 });
  assert.deepEqual(t.repartition.contrats, { cdd: 0, cdi: 0 });
  assert.deepEqual(t.repartition.motifsCdd, { remplacement_absent: 0, surcroit_activite: 0 });
  assert.deepEqual(t.anticipation, { sous7Jours: 0, sous15Jours: 0, demandes: [] });
  assert.equal(t.priorite.nombre, 0);
  assert.deepEqual(t.declarationsTardives, { nombre: 0, nombreValidees: 0, part: null, demandes: [] });
});

test('À traiter en priorité : seulement les deux listes d’action RH, compteur sans doublon (une demande dans les deux listes compte une fois)', () => {
  const t = construireTableauDeBord({
    filtres: {},
    granularite: 'semaine',
    optionsSites: [],
    liens: [],
    bruts: {
      ...BRUTS_VIDES,
      premierJourProche: [{ id: 1, statut: 'envoyee' }, { id: 9, statut: 'en_attente' }],
      aTraiterPlus24h: [{ id: 2, statut: 'envoyee' }, { id: 9, statut: 'en_attente' }],
      valideesEnRetard: [{ id: 3, statut: 'validee', retard_jours: 1 }],
    },
  });
  assert.deepEqual(Object.keys(t.priorite).sort(), ['aTraiterPlus24h', 'nombre', 'premierJourProche']);
  assert.equal(t.priorite.nombre, 3); // 1, 2 et 9 (présente deux fois, comptée une fois)
});

test('Déclarations tardives : nombre, part parmi les validées, liste avec retard et sites', () => {
  const t = construireTableauDeBord({
    filtres: {},
    granularite: 'semaine',
    optionsSites: [],
    liens: [{ demande_dpae_id: 3, id: 10, nom: 'AIGLON', initiales: 'AIG' }],
    bruts: {
      ...BRUTS_VIDES,
      parStatut: [
        { statut: 'envoyee', nombre: 2 },
        { statut: 'validee', nombre: 4 },
      ],
      valideesEnRetard: [{ id: 3, statut: 'validee', retard_jours: 2 }],
    },
  });
  assert.equal(t.declarationsTardives.nombre, 1);
  assert.equal(t.declarationsTardives.nombreValidees, 4);
  assert.equal(t.declarationsTardives.part, 0.25);
  assert.equal(t.declarationsTardives.demandes[0].retard_jours, 2);
  assert.deepEqual(t.declarationsTardives.demandes[0].sites_affectation.map((s) => s.initiales), ['AIG']);
});

test('construireTableauDeBord : taux de rejet sur les décidées, sites rattachés aux lignes, CDD sous 7 j comptés à part', () => {
  const t = construireTableauDeBord({
    filtres: {},
    granularite: 'semaine',
    optionsSites: [],
    liens: [
      { demande_dpae_id: 1, id: 10, nom: 'AIGLON', initiales: 'AIG' },
      { demande_dpae_id: 1, id: 11, nom: 'ALBE', initiales: 'AL' },
    ],
    bruts: {
      ...BRUTS_VIDES,
      parStatut: [
        { statut: 'envoyee', nombre: 5 },
        { statut: 'validee', nombre: 3 },
        { statut: 'rejetee', nombre: 1 },
      ],
      contrats: [
        { cle: 'cdd', nombre: 6 },
        { cle: null, nombre: 3 },
      ],
      dejaEmploye: [
        { cle: true, nombre: 2 },
        { cle: false, nombre: 7 },
      ],
      premierJourProche: [{ id: 1 }, { id: 2 }],
      finsDeCdd: [
        { id: 3, sous_7_jours: true },
        { id: 4, sous_7_jours: false },
      ],
    },
  });
  assert.equal(t.activite.total, 9);
  assert.equal(t.activite.tauxRejet, 0.25);
  assert.deepEqual(t.repartition.contrats, { cdd: 6, cdi: 0, non_renseigne: 3 });
  assert.equal(t.repartition.dejaTravailleChezNous, 2);
  assert.equal(t.repartition.nouveauxSalaries, 7);
  assert.deepEqual(t.priorite.premierJourProche[0].sites_affectation.map((s) => s.initiales), ['AIG', 'AL']);
  assert.deepEqual(t.priorite.premierJourProche[1].sites_affectation, []);
  assert.equal(t.anticipation.sous7Jours, 1);
  assert.equal(t.anticipation.sous15Jours, 2);
});

test('construireTableauDeBord : les demandes « En attente » comptent dans le total et leur compteur, jamais dans les décidées (taux de rejet inchangé)', () => {
  const t = construireTableauDeBord({
    filtres: {},
    granularite: 'semaine',
    optionsSites: [],
    liens: [],
    bruts: {
      ...BRUTS_VIDES,
      parStatut: [
        { statut: 'envoyee', nombre: 2 },
        { statut: 'en_attente', nombre: 4 },
        { statut: 'validee', nombre: 3 },
        { statut: 'rejetee', nombre: 1 },
      ],
      delais: { nombre_traitees: 4, moyen_heures: 10, median_heures: 8 },
    },
  });
  assert.deepEqual(t.activite.parStatut, { a_valider_planning: 0, renvoyee_inspecteur: 0, envoyee: 2, en_attente: 4, validee: 3, rejetee: 1 });
  assert.equal(t.activite.total, 10);
  assert.equal(t.activite.tauxRejet, 0.25); // 1 / (3 + 1) : les 4 en attente ne sont pas décidées
  assert.equal(t.activite.nombreTraitees, 4);
});

// SQL réellement envoyé à la base par une fonction du repository (bd.raw simulé, aucune connexion).
async function sqlEnvoye(t, fonction, ...arguments_) {
  const bd = knex({ client: 'pg' });
  const raw = t.mock.method(bd, 'raw', async () => ({ rows: [{}] }));
  await fonction(bd, 7, { debut: '2026-09-01', fin: '2026-09-30', siteId: null, typeContrat: null, statut: null }, ...arguments_);
  return raw.mock.calls[0].arguments[0];
}

test('À traiter en priorité : « premier jour aujourd’hui ou demain » et « depuis plus de 24 h » portent sur À traiter ET En attente', async (t) => {
  const maintenant = new Date('2026-09-30T10:00:00Z');
  for (const fonction of [tableauDeBordDpaeRepository.listerPremierJourProche, tableauDeBordDpaeRepository.listerATraiterPlus24h]) {
    const sql = await sqlEnvoye(t, fonction, maintenant);
    assert.match(sql, /base\.statut IN \('envoyee', 'en_attente'\)/, fonction.name);
  }
});

test('Délai de traitement RH : de l’envoi à la RH (date_envoi_rh, jamais la création) à la décision finale (date_traitement), qu’une mise en attente ne pose jamais', async (t) => {
  const sql = await sqlEnvoye(t, tableauDeBordDpaeRepository.calculerDelais);
  assert.match(sql, /base\.date_traitement - base\.date_envoi_rh/);
  assert.doesNotMatch(sql, /base\.date_traitement - base\.date_creation/);
  assert.match(sql, /WHERE base\.date_traitement IS NOT NULL AND base\.date_envoi_rh IS NOT NULL/);
  assert.doesNotMatch(sql, /date_mise_en_attente/);
});

test('Déclarations tardives (SQL) : validées seulement, jour de validation (Paris) postérieur au premier jour, retard en jours', async (t) => {
  const sql = await sqlEnvoye(t, tableauDeBordDpaeRepository.listerValideesEnRetard);
  assert.match(sql, /base\.statut = 'validee'/);
  assert.match(sql, /\(base\.date_traitement AT TIME ZONE 'Europe\/Paris'\)::date > base\.date_debut/);
  assert.match(sql, /\(\(base\.date_traitement AT TIME ZONE 'Europe\/Paris'\)::date - base\.date_debut\)::int AS retard_jours/);
});

test('Évolution : une série « en_attente » en plus des trois autres statuts', async (t) => {
  const sql = await sqlEnvoye(t, tableauDeBordDpaeRepository.calculerEvolution, 'semaine');
  for (const statut of ['envoyee', 'en_attente', 'validee', 'rejetee']) {
    assert.match(sql, new RegExp(`FILTER \\(WHERE base\\.statut = '${statut}'\\)::int AS ${statut}`));
  }
});

test('requeteBase : toujours filtrée sur l’entité et sur le jour de création en heure de Paris ; filtres optionnels', () => {
  const bd = knex({ client: 'pg' });
  const base = { debut: '2026-09-01', fin: '2026-09-30', siteId: null, typeContrat: null, statut: null };
  const sql = tableauDeBordDpaeRepository.requeteBase(bd, 7, base).select('d.*').toString();
  assert.match(sql, /"d"\."entite_id" = 7/);
  assert.match(sql, /\(d\.date_creation AT TIME ZONE 'Europe\/Paris'\)::date BETWEEN '2026-09-01'::date AND '2026-09-30'::date/);
  assert.doesNotMatch(sql, /demandes_dpae_sites/);

  const avecSite = tableauDeBordDpaeRepository.requeteBase(bd, 7, { ...base, siteId: 12, typeContrat: 'cdd', statut: 'validee' }).toString();
  assert.match(avecSite, /exists \(select \* from "demandes_dpae_sites" as "l" where l\.demande_dpae_id = d\.id and "l"\."site_affectation_id" = 12\)/);
  assert.match(avecSite, /"d"\."type_contrat" = 'cdd'/);
  assert.match(avecSite, /"d"\."statut" = 'validee'/);

  const nonReference = tableauDeBordDpaeRepository.requeteBase(bd, 7, { ...base, siteId: 'non_reference' }).toString();
  assert.match(nonReference, /not exists \(select \* from "demandes_dpae_sites"/);
});

// ---------------------------------------------------------------------------------------------
// Demandes de chaque indicateur (2026-10-02) : au clic sur un indicateur, le front liste les
// demandes dont les identifiants accompagnent le nombre affiché.
// ---------------------------------------------------------------------------------------------
const ids = (...valeurs) => valeurs;

test('Chaque indicateur cliquable porte autant d’identifiants que le nombre affiché (statuts, total, répartitions, sites, postes, demandeurs, évolution)', () => {
  const t = construireTableauDeBord({
    filtres: {},
    granularite: 'semaine',
    optionsSites: [],
    liens: [],
    bruts: {
      ...BRUTS_VIDES,
      parStatut: [
        { statut: 'envoyee', nombre: 2, ids: ids(1, 2) },
        { statut: 'validee', nombre: 3, ids: ids(3, 4, 5) },
        { statut: 'rejetee', nombre: 1, ids: ids(6) },
      ],
      evolution: [{ periode: '2026-09-28', envoyee: 2, en_attente: 0, validee: 3, rejetee: 1, ids_envoyee: ids(1, 2), ids_en_attente: [], ids_validee: ids(3, 4, 5), ids_rejetee: ids(6) }],
      contrats: [{ cle: 'cdd', nombre: 4, ids: ids(1, 2, 3, 4) }, { cle: null, nombre: 2, ids: ids(5, 6) }],
      motifsCdd: [{ cle: 'remplacement_absent', nombre: 3, ids: ids(1, 2, 3) }, { cle: null, nombre: 1, ids: ids(4) }],
      topSites: [{ id: 51, nom: 'CADRAN', initiales: 'CAD', nombre: 2, ids: ids(1, 3) }],
      nonReferencees: { nombre: 1, ids: ids(6) },
      postes: [{ cle: 'cafetier', nombre: 5, ids: ids(1, 2, 3, 4, 5) }, { cle: null, nombre: 1, ids: ids(6) }],
      demandeurs: [{ id: 9, prenom: 'Thomas', nom: 'Yamini', nombre: 6, ids: ids(1, 2, 3, 4, 5, 6) }],
      dejaEmploye: [{ cle: false, nombre: 4, ids: ids(1, 2, 3, 4) }, { cle: true, nombre: 2, ids: ids(5, 6) }],
    },
  });
  const paires = [
    [t.activite.total, t.activite.ids],
    ...['envoyee', 'en_attente', 'validee', 'rejetee'].map((code) => [t.activite.parStatut[code], t.activite.idsParStatut[code]]),
    ...['envoyee', 'en_attente', 'validee', 'rejetee'].map((code) => [t.activite.evolution[0][code], t.activite.evolution[0][`ids_${code}`]]),
    ...['cdd', 'cdi', 'non_renseigne'].map((cle) => [t.repartition.contrats[cle] ?? 0, t.repartition.idsContrats[cle] ?? []]),
    ...['remplacement_absent', 'surcroit_activite', 'non_renseigne'].map((cle) => [t.repartition.motifsCdd[cle] ?? 0, t.repartition.idsMotifsCdd[cle] ?? []]),
    ...t.repartition.sites.map((site) => [site.nombre, site.ids]),
    [t.repartition.nonReferencees, t.repartition.idsNonReferencees],
    ...t.repartition.postes.map((poste) => [poste.nombre, poste.ids]),
    ...t.repartition.demandeurs.map((demandeur) => [demandeur.nombre, demandeur.ids]),
    [t.repartition.nouveauxSalaries, t.repartition.idsNouveauxSalaries],
    [t.repartition.dejaTravailleChezNous, t.repartition.idsDejaTravailleChezNous],
    [t.declarationsTardives.nombre, t.declarationsTardives.demandes],
  ];
  for (const [nombre, liste] of paires) assert.equal(liste.length, nombre);
  assert.deepEqual(t.activite.ids, [1, 2, 3, 4, 5, 6]);
});

test('Indicateurs (SQL) : chaque agrégat compte et liste les MÊMES lignes, dans la même requête (count et array_agg côte à côte)', async (t) => {
  const r = tableauDeBordDpaeRepository;
  for (const [fonction, ...arguments_] of [
    [r.compterParStatut],
    [r.repartirParContrat],
    [r.repartirMotifsCdd],
    [r.listerTopSites],
    [r.compterNonReferencees],
    [r.repartirParPoste],
    [r.repartirParDemandeur],
    [r.repartirDejaEmploye],
  ]) {
    const sql = await sqlEnvoye(t, fonction, ...arguments_);
    assert.match(sql, /count\((?:DISTINCT )?(?:\*|base\.id)\)::int AS nombre, (?:coalesce\()?array_agg\((?:DISTINCT )?base\.id ORDER BY base\.id\)/, fonction.name);
  }
  const evolution = await sqlEnvoye(t, r.calculerEvolution, 'semaine');
  for (const statut of ['envoyee', 'en_attente', 'validee', 'rejetee']) {
    assert.match(evolution, new RegExp(`coalesce\\(array_agg\\(base\\.id ORDER BY base\\.id\\) FILTER \\(WHERE base\\.statut = '${statut}'\\), '\\{\\}'\\) AS ids_${statut}`));
  }
});
