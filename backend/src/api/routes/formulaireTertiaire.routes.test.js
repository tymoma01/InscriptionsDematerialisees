const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../../core/audit/journalAudit');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const siteAffectationService = require('../../core/dpae/siteAffectationService');
const dpaeRouter = require('./dpae.routes');
const sitesRouter = require('./sitesAffectation.routes');
const { CONFIG_TERTIAIRE: CONFIG_096 } = require('../../db/migrations/096_formulaire_dpae_tertiaire');
const { TYPES_DEMANDE } = require('../../db/migrations/097_type_demande_unique_tertiaire');
const entiteConfig = require('../../entites/accecit/entite.config.json');

// Configuration du Tertiaire telle qu'après les migrations 096 et 097.
const CONFIG_TERTIAIRE = { ...CONFIG_096, formulaire: { ...CONFIG_096.formulaire, types_demande: TYPES_DEMANDE } };

// Formulaire du Tertiaire (modèle papier) sur les VRAIS gestionnaires : CDD surcroît / remplacement, CDI,
// qualification, dates ; le formulaire de l'Hôtellerie reste inchangé. Services mockés.
const ENTITE = { id: 1, code: 'accecit', dpae_config: { echelons_par_poste: { equipier: ['AS', 'ATQS'] }, postes_tous_echelons: ['autre'], tertiaire: CONFIG_TERTIAIRE } };

const BASE_TERTIAIRE = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Léa',
  salarieDejaEmploye: false,
  sitesAffectationIds: [10],
  poste: 'chef_equipe',
  echelon: 'CE2',
  dateDebut: '2026-11-02',
  verifBesoinHotel: false,
  verifTousJoursInclus: false,
  verifNonPlanification: false,
};
const CDD_SURCROIT = { ...BASE_TERTIAIRE, typeContrat: 'cdd', dateFin: '2026-12-02', motifCdd: 'surcroit_activite' };
const CDD_REMPLACEMENT = { ...CDD_SURCROIT, motifCdd: 'remplacement_absent', salarieRemplaceNom: 'Paul Durand', motifAbsence: 'Congé maladie' };

function appeler(routeur, methode, chemin, roleCode, plus = {}) {
  const couche = routeur.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  const res = { statut: 200, corps: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = (corps) => {
    res.corps = corps;
    return res;
  };
  res.end = () => res;
  let erreur = null;
  return couche.route.stack
    .at(-1)
    .handle({ params: {}, query: {}, body: {}, entite: ENTITE, utilisateur: { id: 9, roleCode }, ip: '10.0.0.1', ...plus }, res, (e) => {
      erreur = e;
    })
    .then(() => ({ res, erreur }));
}

const creerDemande = (corps, roleCode = 'planning_tertiaire') => appeler(dpaeRouter, 'post', '/', roleCode, { body: corps });

function mock(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  return t.mock.method(demandeDpaeService, 'creerEtEnvoyer', async () => 41);
}

test('Tertiaire : CDD pour surcroît d’activité accepté, sans nom remplacé ni motif d’absence', async (t) => {
  const creer = mock(t);
  const { res } = await creerDemande({ ...CDD_SURCROIT, salarieRemplaceNom: 'Ignoré', motifAbsence: 'Ignoré' });
  assert.equal(res.statut, 201);
  const donnees = creer.mock.calls[0].arguments[2];
  assert.equal(donnees.motifCdd, 'surcroit_activite');
  assert.equal(donnees.dateFin, '2026-12-02');
  assert.equal(donnees.salarieRemplaceNom, undefined);
  assert.equal(donnees.motifAbsence, undefined);
  assert.equal(donnees.division, 'tertiaire');
  assert.equal(donnees.categorieQualification, 'chef_equipe');
});

test('Tertiaire : CDD de remplacement sans nom ou sans motif d’absence -> 400 ; complet -> accepté et conservé', async (t) => {
  const creer = mock(t);
  const sansNom = await creerDemande({ ...CDD_REMPLACEMENT, salarieRemplaceNom: '' });
  assert.equal(sansNom.res.statut, 400);
  assert.deepEqual(sansNom.res.corps, { erreur: 'Le nom du salarié remplacé est obligatoire pour un remplacement.' });
  const sansMotif = await creerDemande({ ...CDD_REMPLACEMENT, motifAbsence: '   ' });
  assert.equal(sansMotif.res.statut, 400);
  assert.deepEqual(sansMotif.res.corps, { erreur: 'Le motif d’absence est obligatoire pour un remplacement.' });
  assert.equal(creer.mock.callCount(), 0);

  const complet = await creerDemande(CDD_REMPLACEMENT);
  assert.equal(complet.res.statut, 201);
  const donnees = creer.mock.calls[0].arguments[2];
  assert.equal(donnees.salarieRemplaceNom, 'Paul Durand');
  assert.equal(donnees.motifAbsence, 'Congé maladie');
});

test('Tertiaire : textes du remplacement limités à 100 caractères (limite lue dans la configuration)', async (t) => {
  mock(t);
  const long = 'x'.repeat(101);
  const nom = await creerDemande({ ...CDD_REMPLACEMENT, salarieRemplaceNom: long });
  assert.equal(nom.res.statut, 400);
  assert.match(nom.res.corps.erreur, /100 caractères/);
  const motif = await creerDemande({ ...CDD_REMPLACEMENT, motifAbsence: long });
  assert.equal(motif.res.statut, 400);
  assert.match(motif.res.corps.erreur, /100 caractères/);
  assert.equal((await creerDemande({ ...CDD_REMPLACEMENT, salarieRemplaceNom: 'x'.repeat(100), motifAbsence: 'y'.repeat(100) })).res.statut, 201);
});

test('Tertiaire : CDI accepté sans date de fin (une date envoyée est écartée) ; CDD sans date de fin, sans motif, ou date de fin avant l’embauche -> 400', async (t) => {
  const creer = mock(t);
  const cdi = await creerDemande({ ...BASE_TERTIAIRE, typeContrat: 'cdi', dateFin: '2026-12-02' });
  assert.equal(cdi.res.statut, 201);
  assert.equal(creer.mock.calls[0].arguments[2].dateFin, undefined);

  const cas = [
    [{ ...CDD_SURCROIT, dateFin: undefined }, 'La date de fin est obligatoire pour un CDD.'],
    [{ ...CDD_SURCROIT, motifCdd: undefined }, 'Le motif du CDD est obligatoire.'],
    [{ ...CDD_SURCROIT, dateFin: '2026-11-01' }, 'La date de fin ne peut pas précéder la date d’embauche.'],
    [{ ...CDD_SURCROIT, typeContrat: 'avenant' }, 'Le type de contrat d’une demande du Tertiaire doit être : CDD ou CDI.'],
  ];
  for (const [corps, message] of cas) {
    const { res } = await creerDemande(corps);
    assert.equal(res.statut, 400, message);
    assert.deepEqual(res.corps, { erreur: message });
  }
  // Même jour : accepté.
  assert.equal((await creerDemande({ ...CDD_SURCROIT, dateFin: '2026-11-02' })).res.statut, 201);
});

test('Tertiaire : les mêmes règles s’appliquent à la modification (PUT)', async (t) => {
  mock(t);
  const modifier = t.mock.method(demandeDpaeService, 'modifierDemande', async () => ({ statut: 'envoyee', version: 2, noteEnregistree: true }));
  const refus = await appeler(dpaeRouter, 'put', '/:id', 'planning_tertiaire', { params: { id: '5' }, body: { ...CDD_REMPLACEMENT, motifAbsence: '', version: 1, noteModification: 'Correction' } });
  assert.equal(refus.res.statut, 400);
  assert.deepEqual(refus.res.corps, { erreur: 'Le motif d’absence est obligatoire pour un remplacement.' });
  const ok = await appeler(dpaeRouter, 'put', '/:id', 'planning_tertiaire', { params: { id: '5' }, body: { ...CDD_REMPLACEMENT, version: 1, noteModification: 'Correction' } });
  assert.equal(ok.res.statut, 200);
  assert.equal(modifier.mock.calls[0].arguments[2].donnees.motifAbsence, 'Congé maladie');
  // Le Formateur Tertiaire ne peut pas sortir sa demande du Tertiaire en la modifiant.
  await appeler(dpaeRouter, 'put', '/:id', 'inspecteur', { params: { id: '5' }, body: { ...CDD_SURCROIT, division: 'hotellerie', version: 1, noteModification: 'x' } });
  assert.equal(modifier.mock.calls[1].arguments[2].donnees.division, 'tertiaire');
});

test('Hôtellerie inchangée : avenant, poste et échelon de l’Hôtellerie, remplacement sans motif d’absence acceptés', async (t) => {
  const creer = mock(t);
  const hotel = {
    typeDemande: 'nouvelle_embauche',
    salarieNom: 'Martin',
    salariePrenom: 'Léa',
    salarieDejaEmploye: false,
    sitesAffectationIds: [10],
    poste: 'equipier',
    echelon: 'AS',
    dateDebut: '2026-11-02',
    verifBesoinHotel: true,
    verifTousJoursInclus: true,
    verifNonPlanification: true,
  };
  for (const corps of [
    { ...hotel, typeContrat: 'avenant' },
    { ...hotel, typeContrat: 'cdd', dateFin: '2026-12-02', motifCdd: 'remplacement_absent', salarieRemplaceNom: 'Paul' },
    { ...hotel, typeContrat: 'cdi' },
  ]) {
    const { res } = await creerDemande(corps, 'planning');
    assert.equal(res.statut, 201, corps.typeContrat);
  }
  // Pas de motif d'absence ni de catégorie : colonnes nulles à l'enregistrement.
  assert.equal(creer.mock.calls[1].arguments[2].categorieQualification, undefined);
  // Échelon de l'Hôtellerie toujours contrôlé comme avant.
  assert.equal((await creerDemande({ ...hotel, typeContrat: 'cdi', echelon: 'CE9' }, 'planning')).res.statut, 400);
});

// --- Sites du Tertiaire ---------------------------------------------------------------------------
test('Sites : création par un demandeur du Tertiaire (nom + adresse), tracée, secteur Tertiaire ; Hôtellerie inchangée (nom + initiales)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const audit = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const creerTertiaire = t.mock.method(siteAffectationService, 'creerSiteTertiaire', async (_e, { nom, adresse }) => ({ id: 77, nom, initiales: null, adresse }));
  const creerHotel = t.mock.method(siteAffectationService, 'creerSite', async (_e, { nom, initiales }) => ({ id: 78, nom, initiales }));

  for (const roleCode of ['inspecteur', 'planning_tertiaire']) {
    const { res } = await appeler(sitesRouter, 'post', '/', roleCode, { body: { nom: '  Tour Horizon ', adresse: ' 1 rue X ' } });
    assert.equal(res.statut, 201, roleCode);
    assert.deepEqual(res.corps, { id: 77, nom: 'Tour Horizon', initiales: null, adresse: '1 rue X' });
  }
  assert.equal(creerTertiaire.mock.calls[0].arguments[1].creeParId, 9);
  assert.deepEqual(audit.mock.calls[0].arguments[1].action, 'site_affectation_creation');
  assert.equal(audit.mock.calls[0].arguments[1].utilisateurId, 9);

  const hotel = await appeler(sitesRouter, 'post', '/', 'planning', { body: { nom: 'NOUVEL', initiales: 'NOU' } });
  assert.equal(hotel.res.statut, 201);
  assert.equal(creerHotel.mock.callCount(), 1);
  assert.equal(creerTertiaire.mock.callCount(), 2);
});

test('Sites : nom obligatoire (100 caractères au plus), message affiché tel quel', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const sansNom = await appeler(sitesRouter, 'post', '/', 'inspecteur', { body: { nom: ' ' } });
  assert.equal(sansNom.res.statut, 400);
  assert.equal(sansNom.res.corps.erreur, 'Le nom du site est obligatoire.');
  const trop = await appeler(sitesRouter, 'post', '/', 'inspecteur', { body: { nom: 'x'.repeat(101) } });
  assert.equal(trop.res.corps.erreur, 'Le nom du site ne peut pas dépasser 100 caractères.');
});

test('Sites : nom identique ou proche -> 409 avec le site à choisir à la place', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(siteAffectationService, 'creerSiteTertiaire', async () => {
    throw new siteAffectationService.ErreurSiteProche('Un site au nom proche existe déjà : « Tour Horizon ».', { sitesProches: [{ id: 5, nom: 'Tour Horizon' }], identique: false });
  });
  const { res } = await appeler(sitesRouter, 'post', '/', 'inspecteur', { body: { nom: 'Tour Horizo' } });
  assert.equal(res.statut, 409);
  assert.deepEqual(res.corps.sitesProches, [{ id: 5, nom: 'Tour Horizon' }]);
  assert.match(res.corps.erreur, /proche/);
});

test('Sites : la liste du formulaire est celle du secteur du rôle (Tertiaire / Hôtellerie)', async (t) => {
  const lister = t.mock.method(siteAffectationService, 'listerSitesActifs', async () => []);
  await appeler(sitesRouter, 'get', '/', 'inspecteur');
  await appeler(sitesRouter, 'get', '/', 'planning_tertiaire');
  await appeler(sitesRouter, 'get', '/', 'planning');
  await appeler(sitesRouter, 'get', '/', 'admin', { query: { secteur: 'tertiaire' } });
  assert.deepEqual(lister.mock.calls.map((appel) => appel.arguments[1]), ['tertiaire', 'tertiaire', 'hotellerie', 'tertiaire']);
});

function gardes(chemin, methode, roleCode) {
  const couche = sitesRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  const toutes = [...sitesRouter.stack.filter((c) => !c.route).map((c) => c.handle), ...couche.route.stack.slice(0, -1).map((c) => c.handle)];
  const res = { statut: null, status(code) { this.statut = code; return this; }, json() { return this; } };
  for (const garde of toutes) {
    let suite = false;
    garde({ session: { utilisateur: { id: 9, roleCode, entiteId: 1 } }, entite: ENTITE, utilisateur: { id: 9, roleCode } }, res, () => { suite = true; });
    if (!suite) return { autorise: false, statut: res.statut };
  }
  return { autorise: true, statut: null };
}

test('Sites : renommage par le Planning Tertiaire et l’Admin, tracé (auteur, date, ancien et nouveau nom)', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const audit = t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  const renommer = t.mock.method(siteAffectationService, 'renommerSiteTertiaire', async (_e, _id, { nom }) => ({ avant: { nom: 'Tour Horizon' }, apres: { nom } }));
  for (const roleCode of ['planning_tertiaire', 'admin']) {
    const { res } = await appeler(sitesRouter, 'patch', '/:id', roleCode, { params: { id: '5' }, body: { nom: '  Tour Horizon Nord ' } });
    assert.equal(res.statut, 200, roleCode);
    assert.deepEqual(res.corps, { id: 5, nom: 'Tour Horizon Nord' });
  }
  assert.deepEqual(renommer.mock.calls[0].arguments.slice(1), [5, { nom: 'Tour Horizon Nord' }]);
  const entree = audit.mock.calls[0].arguments[1];
  assert.equal(entree.action, 'site_affectation_renommage');
  assert.equal(entree.utilisateurId, 9);
  assert.equal(entree.tableCible, 'sites_affectation');
  assert.deepEqual(entree.donnees, { avant: { nom: 'Tour Horizon' }, apres: { nom: 'Tour Horizon Nord' } });
});

test('Sites : renommage refusé au Formateur Tertiaire et aux autres profils (403, message clair), sans appel au service', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const renommer = t.mock.method(siteAffectationService, 'renommerSiteTertiaire', async () => ({}));
  for (const roleCode of ['inspecteur', 'planning', 'inspecteur_hotellerie']) {
    const { res } = await appeler(sitesRouter, 'patch', '/:id', roleCode, { params: { id: '5' }, body: { nom: 'Autre nom' } });
    assert.equal(res.statut, 403, roleCode);
    assert.deepEqual(res.corps, { erreur: 'Seuls le Planning Tertiaire et l’Admin peuvent renommer un site.' }, roleCode);
  }
  assert.equal(renommer.mock.callCount(), 0);
  // Le Formateur Tertiaire peut toujours ajouter un site.
  assert.equal(gardes('/', 'post', 'inspecteur').autorise, true);
});

test('Sites : renommage en doublon -> 409 avec message ; nom vide ou trop long -> 400', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(siteAffectationService, 'renommerSiteTertiaire', async () => {
    throw new siteAffectationService.ErreurSiteAffectationDoublon('Un site nommé « Gare Nord » existe déjà : ce nom ne peut pas être utilisé.');
  });
  const doublon = await appeler(sitesRouter, 'patch', '/:id', 'planning_tertiaire', { params: { id: '5' }, body: { nom: 'gare  nord' } });
  assert.equal(doublon.res.statut, 409);
  assert.match(doublon.res.corps.erreur, /existe déjà/);
  assert.equal((await appeler(sitesRouter, 'patch', '/:id', 'admin', { params: { id: '5' }, body: { nom: ' ' } })).res.statut, 400);
  assert.equal((await appeler(sitesRouter, 'patch', '/:id', 'admin', { params: { id: '5' }, body: { nom: 'x'.repeat(101) } })).res.corps.erreur, 'Le nom du site ne peut pas dépasser 100 caractères.');
});

test('Sites : plus de route de fusion, de désactivation, de réactivation ni de liste de gestion', () => {
  const routes = sitesRouter.stack.filter((c) => c.route).map((c) => `${Object.keys(c.route.methods)[0]} ${c.route.path}`);
  assert.deepEqual(routes.sort(), ['get /', 'patch /:id', 'post /'].sort());
});

test('Tertiaire : un seul type de demande, « Nouvelle embauche » ; tout autre type refusé (400) avec le message dédié', async (t) => {
  const creer = mock(t);
  assert.equal((await creerDemande(CDD_SURCROIT)).res.statut, 201);
  creer.mock.resetCalls();
  for (const typeDemande of ['prolongation', 'ajout_retrait_jours', 'passage_cdi', 'changement_horaires_affectation']) {
    const { res } = await creerDemande({ ...CDD_SURCROIT, typeDemande }, 'inspecteur');
    assert.equal(res.statut, 400, typeDemande);
    assert.deepEqual(res.corps, { erreur: 'Pour le Tertiaire, seules les nouvelles embauches peuvent être demandées.' }, typeDemande);
  }
  assert.equal(creer.mock.callCount(), 0);
  // Modification : même règle.
  t.mock.method(demandeDpaeService, 'modifierDemande', async () => ({ statut: 'envoyee', version: 2 }));
  const modif = await appeler(dpaeRouter, 'put', '/:id', 'planning_tertiaire', { params: { id: '5' }, body: { ...CDD_SURCROIT, typeDemande: 'prolongation', version: 1, noteModification: 'x' } });
  assert.equal(modif.res.statut, 400);
});

test('Le type de demande du Tertiaire vient de la configuration : migration 097 et entite.config.json', async () => {
  assert.deepEqual(TYPES_DEMANDE, [{ code: 'nouvelle_embauche', libelle: 'Nouvelle embauche' }]);
  assert.deepEqual(entiteConfig.dpae_config.tertiaire.formulaire.types_demande, TYPES_DEMANDE);
  const appels = [];
  const knex = { raw: (sql, parametres) => (appels.push({ sql, parametres }), Promise.resolve()) };
  await require('../../db/migrations/097_type_demande_unique_tertiaire').up(knex);
  assert.match(appels[0].sql, /types_demande/);
  assert.deepEqual(JSON.parse(appels[0].parametres[0]), TYPES_DEMANDE);
});

test('Hôtellerie inchangée : tous ses types de demande restent acceptés', async (t) => {
  mock(t);
  const hotel = { typeDemande: '', salarieNom: 'M', salariePrenom: 'L', salarieDejaEmploye: false, sitesAffectationIds: [10], poste: 'equipier', echelon: 'AS', typeContrat: 'cdi', dateDebut: '2026-11-02', verifBesoinHotel: true, verifTousJoursInclus: true, verifNonPlanification: true };
  for (const typeDemande of ['nouvelle_embauche', 'prolongation', 'ajout_retrait_jours', 'passage_cdi', 'changement_horaires_affectation']) {
    assert.equal((await creerDemande({ ...hotel, typeDemande }, 'planning')).res.statut, 201, typeDemande);
  }
});
