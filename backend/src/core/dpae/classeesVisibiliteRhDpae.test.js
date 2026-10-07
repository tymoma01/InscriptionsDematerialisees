const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const demandeDpaeService = require('./demandeDpaeService');
const notesDemandeDpaeService = require('./notesDemandeDpaeService');
const tableauDeBordDpaeRepository = require('./tableauDeBordDpaeRepository');
const { construireTableauDeBord } = require('./tableauDeBordDpaeService');

// Demandes classées sans suite : la RH ne voit pas celles jamais transmises (date_envoi_rh nulle), elle
// voit celles classées après l'envoi ; Planning, Admin et l'inspecteur auteur voient tout.
const ENTITE = { id: 1, code: 'accecit' };
const CLASSEE_AVANT_RH = { id: 1, entite_id: 1, demandeur_id: 16, statut: 'classee_sans_suite', date_envoi_rh: null, version: 3 };
const CLASSEE_APRES_ENVOI = { id: 2, entite_id: 1, demandeur_id: 16, statut: 'classee_sans_suite', date_envoi_rh: new Date('2026-10-01T10:00:00Z'), version: 3 };

test('peutConsulterDemande : la RH ne voit pas une demande classée depuis « À valider par le Planning », mais voit celle classée depuis « À traiter »', () => {
  const { peutConsulterDemande } = demandeDpaeService;
  assert.equal(peutConsulterDemande({ roleCode: 'rh', utilisateurId: 3, demande: CLASSEE_AVANT_RH }), false);
  assert.equal(peutConsulterDemande({ roleCode: 'rh', utilisateurId: 3, demande: CLASSEE_APRES_ENVOI }), true);
});

test('peutConsulterDemande : Planning, Admin et l’inspecteur (auteur compris) voient toujours les demandes classées', () => {
  const { peutConsulterDemande } = demandeDpaeService;
  for (const demande of [CLASSEE_AVANT_RH, CLASSEE_APRES_ENVOI]) {
    assert.equal(peutConsulterDemande({ roleCode: 'planning', utilisateurId: 8, demande }), true);
    assert.equal(peutConsulterDemande({ roleCode: 'admin', utilisateurId: 1, demande }), true);
    assert.equal(peutConsulterDemande({ roleCode: 'inspecteur_hotellerie', utilisateurId: 16, demande }), true);
  }
});

test('notes d’une demande classée avant la RH : illisibles pour la RH (403), lisibles pour le Planning', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => CLASSEE_AVANT_RH);
  const notesRepo = require('./notesDemandeDpaeRepository');
  t.mock.method(notesRepo, 'listerNotesParDemande', async () => []);
  await assert.rejects(() => notesDemandeDpaeService.listerNotes(ENTITE, 1, { roleCode: 'rh', utilisateurId: 3 }), demandeDpaeService.ErreurModificationInterdite);
  assert.deepEqual(await notesDemandeDpaeService.listerNotes(ENTITE, 1, { roleCode: 'planning', utilisateurId: 8 }), []);
});

test('listes : le filtre est appliqué côté serveur pour la RH (Suivi et file RH), pas pour le Planning ni l’Admin', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const toutesMock = t.mock.method(demandeDpaeRepository, 'listerDemandesPourRh', async () => []);
  t.mock.method(require('./siteAffectationRepository'), 'listerSitesParDemandes', async () => []);
  for (const [roleCode, attendu] of [['rh', true], ['planning', false], ['admin', false]]) {
    await demandeDpaeService.listerSuivi(ENTITE, { utilisateurId: 1, roleCode, perimetreDemande: 'toutes' });
    assert.equal(toutesMock.mock.calls.at(-1).arguments[4], attendu, roleCode);
  }
  await demandeDpaeService.listerPourRh(ENTITE, null);
  assert.equal(toutesMock.mock.calls.at(-1).arguments[4], true);
});

test('SQL : exclusion « classée sans suite ET date_envoi_rh nulle » dans les deux listes et dans le tableau de bord', () => {
  const bd = knex({ client: 'pg' });
  const attendu = /not \("demandes_dpae"\."statut" = \? and "demandes_dpae"\."date_envoi_rh" is null\)/;
  for (const requete of [
    demandeDpaeRepository.listerDemandesPourRh(bd, 1, null, [], true),
    demandeDpaeRepository.listerDemandesParDemandeur(bd, 1, 5, [], true),
  ]) {
    const { sql, bindings } = requete.toSQL();
    assert.match(sql, attendu);
    assert.ok(bindings.includes('classee_sans_suite'));
  }
  // Sans masquage (Planning, Admin) : aucune exclusion.
  assert.doesNotMatch(demandeDpaeRepository.listerDemandesPourRh(bd, 1, null, [], false).toSQL().sql, /date_envoi_rh" is null/);
  assert.match(
    tableauDeBordDpaeRepository.requeteBase(bd, 1, { debut: '2026-10-01', fin: '2026-10-31', masquerClasseesNonTransmises: true }).toSQL().sql,
    /not \("d"\."statut" = \? and "d"\."date_envoi_rh" is null\)/,
  );
  assert.doesNotMatch(tableauDeBordDpaeRepository.requeteBase(bd, 1, { debut: '2026-10-01', fin: '2026-10-31' }).toSQL().sql, /date_envoi_rh" is null/);
});

test('tableau de bord : le total ne compte pas les classées, la répartition par statut les montre', () => {
  const BRUTS = {
    parStatut: [
      { statut: 'envoyee', nombre: 2, ids: [1, 2] },
      { statut: 'validee', nombre: 1, ids: [3] },
      { statut: 'classee_sans_suite', nombre: 3, ids: [4, 5, 6] },
    ],
    dejaEmploye: [], contrats: [], motifsCdd: [], postes: [], demandeurs: [], topSites: [], evolution: [], finsDeCdd: [],
    premierJourProche: [], aTraiterPlus24h: [], valideesEnRetard: [], delais: { nombre_traitees: 0 },
    nonReferencees: { nombre: 0, ids: [] },
  };
  const t = construireTableauDeBord({ filtres: {}, granularite: 'semaine', optionsSites: [], liens: [], bruts: BRUTS });
  assert.equal(t.activite.total, 3);
  assert.deepEqual(t.activite.ids.sort(), [1, 2, 3]);
  assert.equal(t.activite.parStatut.classee_sans_suite, 3);
  assert.deepEqual(t.activite.idsParStatut.classee_sans_suite, [4, 5, 6]);
});

test('SQL tableau de bord : motifs CDD et fins de CDD (anticipation) excluent les classées sans suite ; répartition par contrat inchangée', async () => {
  const requetes = [];
  const reel = knex({ client: 'pg' });
  const bd = Object.assign((...arguments_) => reel(...arguments_), {
    raw: async (sql) => {
      requetes.push(sql);
      return { rows: [] };
    },
  });
  const filtres = { debut: '2026-10-01', fin: '2026-10-31' };
  await tableauDeBordDpaeRepository.repartirMotifsCdd(bd, 1, filtres);
  await tableauDeBordDpaeRepository.listerFinsDeCdd(bd, 1, filtres, new Date());
  await tableauDeBordDpaeRepository.repartirParContrat(bd, 1, filtres);
  assert.match(requetes[0], /base\.type_contrat = 'cdd' AND base\.statut <> 'classee_sans_suite'/);
  assert.match(requetes[1], /base\.statut NOT IN \('rejetee', 'classee_sans_suite'\)/);
  assert.doesNotMatch(requetes[2], /classee_sans_suite/);
});
