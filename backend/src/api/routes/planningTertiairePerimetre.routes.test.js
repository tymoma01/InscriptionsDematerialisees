const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../db/knex');
const perimetreDossiers = require('../../core/auth/perimetreDossiers');
const dossierService = require('../../core/dossier/dossierService');
const rendezvousService = require('../../core/rendezvous/rendezvousService');
const statistiquesService = require('../../core/statistiques/statistiquesService');
const utilisateurService = require('../../core/auth/utilisateurService');
const notificationService = require('../../core/notifications/notificationService');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const demandeDpaeRepository = require('../../core/dpae/demandeDpaeRepository');
const tableauDeBordDpaeService = require('../../core/dpae/tableauDeBordDpaeService');
const pegaseSalarieService = require('../../integrations/pegase/pegaseSalarieService');
const dossiersRouter = require('./dossiers.routes');
const statistiquesRouter = require('./statistiques.routes');
const candidatsRouter = require('./candidats.routes');
const formateursRouter = require('./formateurs.routes');
const notificationsRouter = require('./notifications.routes');
const dpaeRouter = require('./dpae.routes');

// Périmètre Tertiaire du Planning Tertiaire sur CHAQUE route qui lui est ouverte : aucune donnée
// Hôtellerie renvoyée, accès direct à un élément Hôtellerie refusé en 403 avec un message clair. Vrais
// gestionnaires, services mockés.
const ENTITE = { id: 1, code: 'accecit', dpae_config: {} };
const PT = 'planning_tertiaire';
const ROUTEURS = { dossiers: dossiersRouter, statistiques: statistiquesRouter, candidats: candidatsRouter, formateurs: formateursRouter, notifications: notificationsRouter, dpae: dpaeRouter };

const couche = (routeur, methode, chemin) => {
  const trouvee = ROUTEURS[routeur].stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  assert.ok(trouvee, `${routeur} ${methode} ${chemin} introuvable`);
  return trouvee;
};

function reponse() {
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
  res.set = () => res;
  return res;
}

const requete = (roleCode, plus = {}) => ({
  session: { utilisateur: { id: 9, roleCode, entiteId: ENTITE.id } },
  entite: ENTITE,
  utilisateur: { id: 9, roleCode },
  params: {},
  query: {},
  body: {},
  ip: '10.0.0.1',
  ...plus,
});

async function appeler(routeur, methode, chemin, roleCode, plus) {
  const res = reponse();
  let erreur = null;
  await couche(routeur, methode, chemin).route.stack.at(-1).handle(requete(roleCode, plus), res, (e) => {
    erreur = e;
  });
  return { res, erreur };
}

// Gardes (authentification, permission) d'une route, sans son gestionnaire.
function passeLesGardes(routeur, methode, chemin, roleCode) {
  const gardes = [...ROUTEURS[routeur].stack.filter((c) => !c.route).map((c) => c.handle), ...couche(routeur, methode, chemin).route.stack.slice(0, -1).map((c) => c.handle)];
  const res = reponse();
  for (const garde of gardes) {
    let suivant = false;
    garde(requete(roleCode), res, () => {
      suivant = true;
    });
    if (!suivant) return { autorise: false, statut: res.statut };
  }
  return { autorise: true, statut: null };
}

const REFUS_DONNEES = "Ces données concernent l'entité Hôtellerie : elles sont traitées par le Planning Hôtellerie.";

test('GET /dossiers : le service reçoit le périmètre Tertiaire (candidats du secteur bureau, tous statuts)', async (t) => {
  const lister = t.mock.method(dossierService, 'listerDossiers', async () => []);
  await appeler('dossiers', 'get', '/', PT);
  const perimetre = lister.mock.calls[0].arguments[1].perimetre;
  assert.equal(perimetre.typePoste, 'bureau');
  assert.equal(perimetre.statutsCodes, undefined);
});

test('GET /dossiers/suivi-formation : fermé au Planning Tertiaire (403) ; le Planning Hôtellerie garde l’accès', () => {
  assert.deepEqual(passeLesGardes('dossiers', 'get', '/suivi-formation', PT), { autorise: false, statut: 403 });
  assert.equal(passeLesGardes('dossiers', 'get', '/suivi-formation', 'planning').autorise, true);
  assert.equal(passeLesGardes('dossiers', 'get', '/suivi-formation', 'accueil_coordination').autorise, true);
});

test('GET /dossiers/rendezvous (Suivi des tests) : seulement les rendez-vous du secteur Tertiaire ; Planning Hôtellerie sans filtre de secteur', async (t) => {
  const lister = t.mock.method(rendezvousService, 'listerRendezvousTest', async () => []);
  await appeler('dossiers', 'get', '/rendezvous', PT);
  await appeler('dossiers', 'get', '/rendezvous', 'planning');
  assert.equal(lister.mock.calls[0].arguments[1].typePoste, 'bureau');
  assert.equal(lister.mock.calls[1].arguments[1].typePoste, null);
});

test('GET /dossiers/rendezvous/historique et /pieces/export-zip-groupe : un dossier Hôtellerie dans la sélection -> 403 pour toute la requête, aucune donnée', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const hors = t.mock.method(perimetreDossiers, 'dossiersHorsPerimetre', async (_bd, _e, ids) => ids.filter((id) => id === 113));
  const historique = t.mock.method(rendezvousService, 'listerHistoriqueRendezvousDossiers', async () => ({ rendezvous: [], notes: [] }));
  const resume = t.mock.method(dossierService, 'listerResumesParIds', async () => []);

  const refusHistorique = await appeler('dossiers', 'get', '/rendezvous/historique', PT, { query: { dossierIds: '12,113' } });
  assert.equal(refusHistorique.res.statut, 403);
  assert.deepEqual(refusHistorique.res.corps, { erreur: REFUS_DONNEES });
  assert.equal(historique.mock.callCount(), 0);

  const refusExport = await appeler('dossiers', 'get', '/pieces/export-zip-groupe', PT, { query: { dossierIds: '113' } });
  assert.equal(refusExport.res.statut, 403);
  assert.deepEqual(refusExport.res.corps, { erreur: REFUS_DONNEES });
  assert.equal(resume.mock.callCount(), 0);

  const ok = await appeler('dossiers', 'get', '/rendezvous/historique', PT, { query: { dossierIds: '12' } });
  assert.equal(ok.res.statut, 200);
  assert.equal(historique.mock.callCount(), 1);
  hors.mock.restore();
});

test('Le Planning Hôtellerie et la RH gardent leur comportement : aucune vérification de périmètre sur une sélection', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const hors = t.mock.method(perimetreDossiers, 'dossiersHorsPerimetre', async (_bd, _e, ids) => ids);
  t.mock.method(rendezvousService, 'listerHistoriqueRendezvousDossiers', async () => ({ rendezvous: [], notes: [] }));
  for (const roleCode of ['planning', 'rh']) {
    const { res } = await appeler('dossiers', 'get', '/rendezvous/historique', roleCode, { query: { dossierIds: '113' } });
    assert.equal(res.statut, 200, roleCode);
  }
  assert.equal(hors.mock.callCount(), 0);
});

test('GET /dossiers/:dossierId et routes de dossier (pièces, notes, relances, transitions…) : dossier Hôtellerie -> 403 avec message clair', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  t.mock.method(perimetreDossiers, 'dossierDansPerimetre', async () => false);
  const res = reponse();
  let suite = false;
  await perimetreDossiers.verifierPerimetreDossier(requete(PT, { params: { dossierId: '113' } }), res, () => {
    suite = true;
  });
  assert.equal(res.statut, 403);
  assert.equal(res.corps.erreur, "Ce dossier concerne l'entité Hôtellerie : il est traité par le Planning Hôtellerie.");
  assert.equal(suite, false);
});

test('GET /statistiques/kpi et /kpi/dossiers : secteur Tertiaire imposé ; secteur ou poste Hôtellerie demandé -> 403', async (t) => {
  const kpi = t.mock.method(statistiquesService, 'obtenirIndicateursKpi', async () => ({}));
  const liste = t.mock.method(statistiquesService, 'listerDossiersParIndicateurs', async () => []);
  const periode = { dateDebut: '2026-09-01', dateFin: '2026-09-30' };

  await appeler('statistiques', 'get', '/kpi', PT, { query: periode });
  assert.equal(kpi.mock.calls[0].arguments[1].typePoste, 'bureau');
  await appeler('statistiques', 'get', '/kpi/dossiers', PT, { query: { ...periode, indicateurs: 'inscrits' } });
  assert.equal(liste.mock.calls[0].arguments[1].typePoste, 'bureau');

  for (const [chemin, extra] of [['/kpi', {}], ['/kpi/dossiers', { indicateurs: 'inscrits' }]]) {
    for (const filtre of [{ typePoste: 'hotel' }, { poste: 'equipier' }, { typePoste: 'hotel', poste: 'gouvernant' }]) {
      const { res } = await appeler('statistiques', 'get', chemin, PT, { query: { ...periode, ...extra, ...filtre } });
      assert.equal(res.statut, 403, `${chemin} ${JSON.stringify(filtre)}`);
      assert.deepEqual(res.corps, { erreur: REFUS_DONNEES });
    }
  }
  assert.equal(kpi.mock.callCount(), 1);
  assert.equal(liste.mock.callCount(), 1);
  // Un poste du Tertiaire est accepté.
  const { res } = await appeler('statistiques', 'get', '/kpi', PT, { query: { ...periode, poste: 'nettoyage' } });
  assert.equal(res.statut, 200);
});

test('GET /candidats/recherche : seuls les candidats du Tertiaire sont cherchés', async (t) => {
  const chercher = t.mock.method(dossierService, 'rechercherCandidats', async () => []);
  await appeler('candidats', 'get', '/recherche', PT, { query: { q: 'ma' } });
  await appeler('candidats', 'get', '/recherche', 'planning', { query: { q: 'ma' } });
  assert.deepEqual(chercher.mock.calls[0].arguments[2], { typePoste: 'bureau' });
  assert.deepEqual(chercher.mock.calls[1].arguments[2], { typePoste: null });
});

test('GET /formateurs : seuls les formateurs du Tertiaire sont proposés au Planning Tertiaire', async (t) => {
  t.mock.method(utilisateurService, 'listerFormateursEtInspecteurs', async () => [
    { id: 1, role_code: 'formateur' },
    { id: 2, role_code: 'inspecteur' },
  ]);
  assert.deepEqual((await appeler('formateurs', 'get', '/', PT)).res.corps.map((f) => f.id), [2]);
  assert.deepEqual((await appeler('formateurs', 'get', '/', 'planning')).res.corps.map((f) => f.id), [1, 2]);
});

test('GET /notifications : toujours celles de l’utilisateur connecté (les notifications DPAE du Tertiaire ne vont qu’au Planning Tertiaire)', async (t) => {
  const lister = t.mock.method(notificationService, 'listerPourUtilisateur', async () => []);
  await appeler('notifications', 'get', '/', PT, { query: { utilisateurId: '5' } });
  assert.deepEqual(lister.mock.calls[0].arguments, [9]);
});

// --- DPAE ---------------------------------------------------------------------------------------
const demandeHotellerie = { id: 5, statut: 'envoyee', division: 'hotellerie', demandeur_id: 3, date_envoi_rh: new Date(), salarie_nom: 'Martin', salarie_prenom: 'Léa' };
const MESSAGE_HOTELLERIE = "Cette demande concerne l'entité Hôtellerie : elle est traitée par le Planning Hôtellerie et la RH.";

test('DPAE : fiche, PDF, notes (lecture et ajout), relance Pégase, export PDF sur une demande Hôtellerie -> 403 avec message clair', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({ transaction: async (callback) => callback({}) }));
  t.mock.method(demandeDpaeService, 'obtenirDemande', async () => demandeHotellerie);
  t.mock.method(demandeDpaeRepository, 'trouverDemandeParId', async () => demandeHotellerie);
  const suivi = t.mock.method(pegaseSalarieService, 'suiviPourDemande', async () => ({ relancePossible: true }));
  const refus = [
    ['get', '/:id', {}],
    ['get', '/:id/pdf', {}],
    ['get', '/:id/notes', {}],
    ['post', '/:id/notes', { body: { contenu: 'Note.' } }],
    ['post', '/:id/pegase/relancer', {}],
  ];
  for (const [methode, chemin, plus] of refus) {
    const { res, erreur } = await appeler('dpae', methode, chemin, PT, { params: { id: '5' }, ...plus });
    assert.equal(erreur, null, `${methode} ${chemin}`);
    assert.equal(res.statut, 403, `${methode} ${chemin}`);
    assert.deepEqual(res.corps, { erreur: MESSAGE_HOTELLERIE }, `${methode} ${chemin}`);
  }
  assert.equal(suivi.mock.callCount(), 0);
  const exportation = await appeler('dpae', 'post', '/export-pdf', PT, { body: { demandeIds: [5] } });
  assert.equal(exportation.res.statut, 403);
  assert.match(exportation.res.corps.erreur, /Hôtellerie/);
});

test('DPAE : les listes (suivi, file de traitement, à valider) et le tableau de bord sont limités au Tertiaire pour le Planning Tertiaire', async (t) => {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const suivi = t.mock.method(demandeDpaeService, 'listerSuivi', async () => []);
  const file = t.mock.method(demandeDpaeService, 'listerPourRh', async () => []);
  const aValider = t.mock.method(demandeDpaeService, 'listerAValider', async () => []);
  const tableau = t.mock.method(tableauDeBordDpaeService, 'calculerTableauDeBord', async () => ({}));
  await appeler('dpae', 'get', '/suivi', PT);
  await appeler('dpae', 'get', '/', PT);
  await appeler('dpae', 'get', '/a-valider', PT);
  await appeler('dpae', 'get', '/tableau-de-bord', PT, { query: { entite: 'hotellerie' } });
  assert.equal(suivi.mock.calls[0].arguments[1].roleCode, PT);
  assert.equal(file.mock.calls[0].arguments[2].roleCode, PT);
  assert.equal(aValider.mock.calls[0].arguments[1].roleCode, PT);
  // Le filtre d'entité demandé par le client ne peut pas élargir le périmètre du rôle.
  assert.equal(tableau.mock.calls[0].arguments[4].entiteDpae, 'tertiaire');
});
