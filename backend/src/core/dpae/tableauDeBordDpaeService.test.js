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
  enAttentePlus24h: [],
  valideesEnRetard: [],
  parStatut: [],
  delais: { nombre_traitees: 0, moyen_heures: null, median_heures: null },
  evolution: [],
  contrats: [],
  motifsCdd: [],
  topSites: [],
  nonReferencees: 0,
  postes: [],
  demandeurs: [],
  dejaEmploye: [],
  finsDeCdd: [],
};

test('construireTableauDeBord : sans aucune décision, taux de rejet null (jamais un 0 % trompeur) et compteurs à zéro', () => {
  const t = construireTableauDeBord({ filtres: {}, granularite: 'semaine', optionsSites: [], liens: [], bruts: BRUTS_VIDES });
  assert.equal(t.activite.total, 0);
  assert.equal(t.activite.tauxRejet, null);
  assert.deepEqual(t.activite.parStatut, { envoyee: 0, validee: 0, rejetee: 0 });
  assert.deepEqual(t.repartition.contrats, { cdd: 0, cdi: 0 });
  assert.deepEqual(t.repartition.motifsCdd, { remplacement_absent: 0, surcroit_activite: 0 });
  assert.deepEqual(t.anticipation, { sous7Jours: 0, sous15Jours: 0, demandes: [] });
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
