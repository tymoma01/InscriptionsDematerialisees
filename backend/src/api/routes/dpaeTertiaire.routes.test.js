const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const journalAudit = require('../../core/audit/journalAudit');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const pegaseSalarieService = require('../../integrations/pegase/pegaseSalarieService');
const dpaeRouter = require('./dpae.routes');

// DPAE du Tertiaire sur les VRAIS gestionnaires de routes (services mockés) : entité imposée à la
// création, postes du Tertiaire, refus 403 par entité avec leur message, motif du renvoi.
const ENTITE = {
  id: 1,
  code: 'accecit',
  dpae_config: {
    echelons_par_poste: { equipier: ['AS', 'ATQS'] },
    postes_tous_echelons: ['autre'],
    tertiaire: { postes: ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autre'], echelons_par_poste: {}, postes_tous_echelons: [] },
  },
};

const DEMANDE = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Léa',
  salarieDejaEmploye: false,
  sitesAffectationIds: [10],
  poste: 'nettoyage',
  typeContrat: 'cdi',
  dateDebut: '2026-10-12',
  verifBesoinHotel: true,
  verifTousJoursInclus: true,
  verifNonPlanification: true,
};

function gestionnaire(methode, chemin) {
  const couche = dpaeRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  return couche.route.stack.at(-1).handle;
}

async function appeler(methode, chemin, { params, body, roleCode, utilisateurId = 9 }) {
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
  let erreurTransmise = null;
  await gestionnaire(methode, chemin)({ params, body, query: {}, entite: ENTITE, utilisateur: { id: utilisateurId, roleCode }, ip: '10.0.0.1' }, res, (e) => {
    erreurTransmise = e;
  });
  return { res, erreurTransmise };
}

function mockerBase(t) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(journalAudit, 'enregistrerAction', async () => {});
  t.mock.method(pegaseSalarieService, 'suiviPourDemande', async () => null);
}

// --- Création ------------------------------------------------------------------------------------
test('Création : le Formateur Tertiaire et le Planning Tertiaire créent pour le Tertiaire, entité fixée même si le client en envoie une autre', async (t) => {
  mockerBase(t);
  const creer = t.mock.method(demandeDpaeService, 'creerEtEnvoyer', async () => 41);
  for (const roleCode of ['inspecteur', 'planning_tertiaire']) {
    for (const division of [undefined, 'hotellerie', 'autre', 'tertiaire']) {
      creer.mock.resetCalls();
      const { res } = await appeler('post', '/', { body: { ...DEMANDE, ...(division ? { division, divisionAutre: 'x' } : {}) }, roleCode });
      assert.equal(res.statut, 201, `${roleCode} ${division}`);
      const donnees = creer.mock.calls[0].arguments[2];
      assert.equal(donnees.division, 'tertiaire', `${roleCode} ${division}`);
      assert.equal(donnees.divisionAutre, undefined);
      assert.equal(creer.mock.calls[0].arguments[3].roleCode, roleCode);
    }
  }
});

test('Création Tertiaire : seuls les postes du Tertiaire sont acceptés (Nettoyage, Vitrerie, Machiniste, Chef d’équipe, Autre) ; pas d’échelon', async (t) => {
  mockerBase(t);
  const creer = t.mock.method(demandeDpaeService, 'creerEtEnvoyer', async () => 41);
  for (const poste of ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autre']) {
    const { res } = await appeler('post', '/', { body: { ...DEMANDE, poste, echelon: 'AS' }, roleCode: 'planning_tertiaire' });
    assert.equal(res.statut, 201, poste);
    assert.equal(creer.mock.calls.at(-1).arguments[2].echelon, null, `${poste} : l’échelon du Tertiaire reste vide tant qu’il n’est pas configuré`);
  }
  creer.mock.resetCalls();
  for (const poste of ['equipier', 'gouvernant', 'femme_valet_chambre']) {
    const { res } = await appeler('post', '/', { body: { ...DEMANDE, poste }, roleCode: 'inspecteur' });
    assert.equal(res.statut, 400, poste);
  }
  assert.equal(creer.mock.callCount(), 0);
});

test('Création : un rôle limité à l’Hôtellerie ne crée pas de demande Tertiaire (400) ; l’Admin choisit librement', async (t) => {
  mockerBase(t);
  const creer = t.mock.method(demandeDpaeService, 'creerEtEnvoyer', async () => 41);
  for (const roleCode of ['planning', 'inspecteur_hotellerie']) {
    const { res } = await appeler('post', '/', { body: { ...DEMANDE, poste: 'equipier', division: 'tertiaire' }, roleCode });
    assert.equal(res.statut, 400, roleCode);
  }
  const hotel = await appeler('post', '/', { body: { ...DEMANDE, poste: 'equipier', echelon: 'AS', division: 'hotellerie' }, roleCode: 'planning' });
  assert.equal(hotel.res.statut, 201);
  const admin = await appeler('post', '/', { body: { ...DEMANDE, division: 'tertiaire' }, roleCode: 'admin' });
  assert.equal(admin.res.statut, 201);
  assert.equal(creer.mock.callCount(), 2);
});

test('Configuration du formulaire : entité imposée, postes et échelons du Tertiaire (liste d’échelons vide par défaut)', async (t) => {
  mockerBase(t);
  const tertiaire = await appeler('get', '/configuration', { roleCode: 'inspecteur' });
  assert.equal(tertiaire.res.corps.entiteImposee, 'tertiaire');
  assert.deepEqual(tertiaire.res.corps.postesTertiaire, ['nettoyage', 'vitrerie', 'machiniste', 'chef_equipe', 'autre']);
  assert.deepEqual(tertiaire.res.corps.echelonsParPosteTertiaire, {});
  assert.deepEqual(tertiaire.res.corps.echelonsParPoste.equipier, ['AS', 'ATQS']);
  assert.equal((await appeler('get', '/configuration', { roleCode: 'planning' })).res.corps.entiteImposee, 'hotellerie');
  assert.equal((await appeler('get', '/configuration', { roleCode: 'admin' })).res.corps.entiteImposee, null);
});

// --- Refus par entité --------------------------------------------------------------------------
const demandeFiche = (division, surcharges = {}) => ({
  id: 5,
  statut: 'envoyee',
  division,
  demandeur_id: 3,
  date_envoi_rh: new Date(),
  salarie_nom: 'Martin',
  salarie_prenom: 'Léa',
  sites_affectation: [],
  ...surcharges,
});

test('Fiche : accès hors périmètre -> 403 avec le message de l’entité ; dans le périmètre et Admin -> fiche', async (t) => {
  mockerBase(t);
  const obtenir = t.mock.method(demandeDpaeService, 'obtenirDemande', async () => demandeFiche('tertiaire'));
  for (const roleCode of ['rh', 'planning', 'inspecteur_hotellerie']) {
    const { res } = await appeler('get', '/:id', { params: { id: '5' }, roleCode });
    assert.equal(res.statut, 403, roleCode);
    assert.deepEqual(res.corps, { erreur: "Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire." }, roleCode);
  }
  for (const roleCode of ['planning_tertiaire', 'admin']) assert.equal((await appeler('get', '/:id', { params: { id: '5' }, roleCode })).res.statut, 200, roleCode);

  obtenir.mock.restore();
  t.mock.method(demandeDpaeService, 'obtenirDemande', async () => demandeFiche('hotellerie'));
  const refus = await appeler('get', '/:id', { params: { id: '5' }, roleCode: 'planning_tertiaire' });
  assert.equal(refus.res.statut, 403);
  assert.deepEqual(refus.res.corps, { erreur: "Cette demande concerne l'entité Hôtellerie : elle est traitée par le Planning Hôtellerie et la RH." });
  for (const roleCode of ['rh', 'planning', 'admin']) assert.equal((await appeler('get', '/:id', { params: { id: '5' }, roleCode })).res.statut, 200, roleCode);
});

test('PDF : même refus par entité que la fiche, aucun PDF', async (t) => {
  mockerBase(t);
  t.mock.method(demandeDpaeService, 'obtenirDemande', async () => demandeFiche('tertiaire'));
  const { res } = await appeler('get', '/:id/pdf', { params: { id: '5' }, roleCode: 'rh' });
  assert.equal(res.statut, 403);
  assert.match(res.corps.erreur, /^Cette demande concerne l'entité Tertiaire/);
});

test('Actions du service refusées par entité : 403 et message affiché tel quel (valider, rejeter, mettre en attente, renvoyer)', async (t) => {
  mockerBase(t);
  const message = "Cette demande concerne l'entité Tertiaire : elle est traitée par le Planning Tertiaire.";
  for (const [chemin, methode] of [
    ['/:id/valider', 'valider'],
    ['/:id/rejeter', 'rejeter'],
    ['/:id/mettre-en-attente', 'mettreEnAttente'],
    ['/:id/renvoyer-inspecteur', 'renvoyerAInspecteur'],
  ]) {
    t.mock.method(demandeDpaeService, methode, async () => {
      throw new demandeDpaeService.ErreurEntiteHorsPerimetre(message);
    });
    const { res } = await appeler('patch', chemin, { params: { id: '5' }, body: { version: 1, motif: 'x' }, roleCode: chemin.includes('renvoyer') ? 'planning' : 'rh' });
    assert.equal(res.statut, 403, chemin);
    assert.deepEqual(res.corps, { erreur: message }, chemin);
  }
});

// --- Renvoi au formateur --------------------------------------------------------------------------
test('Renvoi sans motif : 400 « Le motif du renvoi est obligatoire. » ; avec motif, transmis au service', async (t) => {
  mockerBase(t);
  const renvoyer = t.mock.method(demandeDpaeService, 'renvoyerAInspecteur', async (_e, _id, _u, { motif }) => {
    if (!motif) throw new demandeDpaeService.ErreurMotifRenvoiObligatoire();
  });
  const sansMotif = await appeler('patch', '/:id/renvoyer-inspecteur', { params: { id: '5' }, body: { version: 2 }, roleCode: 'planning_tertiaire' });
  assert.equal(sansMotif.res.statut, 400);
  assert.deepEqual(sansMotif.res.corps, { erreur: 'Le motif du renvoi est obligatoire.' });

  const avecMotif = await appeler('patch', '/:id/renvoyer-inspecteur', { params: { id: '5' }, body: { version: 2, motif: 'Site manquant.' }, roleCode: 'planning_tertiaire', utilisateurId: 8 });
  assert.equal(avecMotif.res.statut, 204);
  assert.deepEqual(renvoyer.mock.calls.at(-1).arguments.slice(1), [5, 8, { version: 2, adresseIp: '10.0.0.1', roleCode: 'planning_tertiaire', motif: 'Site manquant.' }]);
});

test('Le formateur renvoie sa demande corrigée au Planning Tertiaire (route inchangée, droit de l’auteur)', async (t) => {
  mockerBase(t);
  const envoyer = t.mock.method(demandeDpaeService, 'envoyerAuPlanning', async () => {});
  const { res } = await appeler('patch', '/:id/envoyer-au-planning', { params: { id: '5' }, body: { version: 3 }, roleCode: 'inspecteur', utilisateurId: 1 });
  assert.equal(res.statut, 204);
  assert.deepEqual(envoyer.mock.calls[0].arguments.slice(1), [5, 1, { version: 3, adresseIp: '10.0.0.1', roleCode: 'inspecteur' }]);
});
