// Rôle Inspecteur Hôtellerie (2026-10-01) — droits testés sur les VRAIES gardes montées (convention du
// projet : aucune infrastructure de test HTTP, on exécute les middlewares de la pile du routeur), plus
// le périmètre de dossiers (core/auth/perimetreDossiers.js) et le filtrage côté serveur.
const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const db = require('../../db/knex');
const { ROLES } = require('../../core/auth/rbac');
const perimetreDossiers = require('../../core/auth/perimetreDossiers');
const dossierRepository = require('../../core/dossier/dossierRepository');
const dossierService = require('../../core/dossier/dossierService');
const statistiquesService = require('../../core/statistiques/statistiquesService');

const ROUTEURS = {
  dossiers: require('./dossiers.routes'),
  pieces: require('./pieces.routes'),
  relances: require('./relances.routes'),
  notes: require('./notes.routes'),
  formation: require('./formation.routes'),
  rendezvous: require('./rendezvous.routes'),
  transitions: require('./transitions.routes'),
  evaluations: require('./evaluations.routes'),
  formateurs: require('./formateurs.routes'),
  lieux: require('./lieux.routes'),
  statistiques: require('./statistiques.routes'),
  utilisateurs: require('./utilisateurs.routes'),
  dpae: require('./dpae.routes'),
  sitesAffectation: require('./sitesAffectation.routes'),
  candidats: require('./candidats.routes'),
  disponibilites: require('./rendezvousDisponibilites.routes'),
};

const IH = ROLES.INSPECTEUR_HOTELLERIE;
const ENTITE = { id: 1, code: 'accecit' };

// Exécute les gardes réellement montées : middlewares de niveau routeur (router.use : requireAuth,
// requireRole…) puis ceux de la route, SAUF le gestionnaire final. Autorisé = aucune garde n'a répondu.
function passeLesGardes(nomRouteur, methode, chemin, roleCode) {
  const routeur = ROUTEURS[nomRouteur];
  const couche = routeur.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  assert.ok(couche, `${nomRouteur} : route ${methode.toUpperCase()} ${chemin} introuvable`);
  const gardes = [
    ...routeur.stack.filter((c) => !c.route).map((c) => c.handle),
    ...couche.route.stack.slice(0, -1).map((c) => c.handle),
  ];
  const utilisateur = { id: 9, roleCode, entiteId: ENTITE.id };
  const req = { session: { utilisateur }, entite: ENTITE, params: {}, query: {}, body: {} };
  const res = { statut: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = () => res;
  for (const garde of gardes) {
    let suivant = false;
    garde(req, res, () => {
      suivant = true;
    });
    if (!suivant) return { autorise: false, statut: res.statut };
  }
  return { autorise: true, statut: null };
}

// --- Accès autorisés ---------------------------------------------------------------------------------
const AUTORISEES = [
  ['statistiques', 'get', '/kpi'],
  ['statistiques', 'get', '/kpi/dossiers'],
  ['dossiers', 'get', '/'],
  ['dossiers', 'get', '/statuts'],
  ['dossiers', 'get', '/derniere-modification'],
  ['dossiers', 'get', '/:dossierId'],
  ['dossiers', 'get', '/:dossierId/inscription'],
  ['dossiers', 'get', '/:dossierId/evaluation'],
  ['rendezvous', 'get', '/'],
  ['formation', 'get', '/'],
  ['notes', 'get', '/'],
  ['dpae', 'post', '/'],
  ['dpae', 'get', '/suivi'],
  ['dpae', 'get', '/:id'],
  ['dpae', 'get', '/:id/notes'],
  ['sitesAffectation', 'get', '/'],
  ['sitesAffectation', 'post', '/'],
  ['candidats', 'get', '/recherche'],
];

test('Inspecteur Hôtellerie : accès autorisés (tableau de bord, dossiers et fiche en lecture, Tests/Formation/notes en lecture, DPAE comme Planning)', () => {
  for (const [routeur, methode, chemin] of AUTORISEES) {
    assert.equal(passeLesGardes(routeur, methode, chemin, IH).autorise, true, `${routeur} ${methode.toUpperCase()} ${chemin}`);
  }
});

// --- Refus : 403 -------------------------------------------------------------------------------------
const INTERDITES = [
  // Écritures sur un dossier
  ['dossiers', 'patch', '/:dossierId/inscription'],
  ['dossiers', 'post', '/:dossierId/disponibilite-embauche'],
  ['notes', 'post', '/'],
  ['rendezvous', 'post', '/'],
  ['rendezvous', 'post', '/avec-transitions'],
  ['rendezvous', 'patch', '/:rendezvousId'],
  ['relances', 'post', '/'],
  ['relances', 'get', '/'],
  ['transitions', 'get', '/'],
  ['transitions', 'post', '/'],
  ['transitions', 'post', '/forcer-statut'],
  ['transitions', 'post', '/marquer-embauche'],
  // Pièces justificatives : aucune (liste, téléchargement, aperçu, ZIP, écriture)
  ['pieces', 'get', '/'],
  ['pieces', 'get', '/:pieceId'],
  ['pieces', 'get', '/:pieceId/apercu'],
  ['pieces', 'get', '/export-zip'],
  ['pieces', 'post', '/'],
  ['pieces', 'patch', '/:pieceId'],
  ['pieces', 'delete', '/:pieceId'],
  ['dossiers', 'get', '/pieces/export-zip-groupe'],
  // Écrans interdits : Suivi des tests, Suivi des formations, évaluations, comptes, lieux…
  ['dossiers', 'get', '/rendezvous'],
  ['dossiers', 'get', '/suivi-formation'],
  ['evaluations', 'get', '/a-faire'],
  ['evaluations', 'get', '/historique'],
  ['evaluations', 'post', '/'],
  ['formateurs', 'get', '/'],
  ['lieux', 'get', '/'],
  ['disponibilites', 'get', '/disponibilites'],
  ['utilisateurs', 'get', '/'],
  ['utilisateurs', 'post', '/'],
  // DPAE : ni traitement RH, ni tableau de bord DPAE, ni ajout de note
  ['dpae', 'get', '/'],
  ['dpae', 'patch', '/:id/valider'],
  ['dpae', 'patch', '/:id/rejeter'],
  ['dpae', 'patch', '/:id/mettre-en-attente'],
  ['dpae', 'get', '/tableau-de-bord'],
  ['dpae', 'post', '/:id/notes'],
];

test('Inspecteur Hôtellerie : 403 sur toute écriture, les pièces, le traitement RH, le tableau de bord DPAE et les écrans interdits', () => {
  for (const [routeur, methode, chemin] of INTERDITES) {
    const { autorise, statut } = passeLesGardes(routeur, methode, chemin, IH);
    assert.equal(autorise, false, `${routeur} ${methode.toUpperCase()} ${chemin}`);
    assert.equal(statut, 403, `${routeur} ${methode.toUpperCase()} ${chemin}`);
  }
});

// --- Jamais confondu avec 'inspecteur', droits des autres rôles inchangés ------------------------------
test("'inspecteur' et 'inspecteur_hotellerie' ne sont jamais confondus : codes distincts, droits distincts", () => {
  assert.notEqual(ROLES.INSPECTEUR, ROLES.INSPECTEUR_HOTELLERIE);
  // Ce qu'a l'Inspecteur (Formateur Tertiaire) et pas l'Inspecteur Hôtellerie…
  for (const [routeur, methode, chemin] of [
    ['evaluations', 'get', '/a-faire'],
    ['evaluations', 'post', '/'],
    ['transitions', 'post', '/'],
    ['pieces', 'get', '/'],
    ['relances', 'get', '/'],
  ]) {
    assert.equal(passeLesGardes(routeur, methode, chemin, ROLES.INSPECTEUR).autorise, true, `inspecteur ${chemin}`);
    assert.equal(passeLesGardes(routeur, methode, chemin, IH).autorise, false, `inspecteur_hotellerie ${chemin}`);
  }
  // … et inversement (DPAE, tableau de bord) : l'Inspecteur n'y gagne rien.
  for (const [routeur, methode, chemin] of [
    ['dpae', 'post', '/'],
    ['dpae', 'get', '/suivi'],
    ['statistiques', 'get', '/kpi'],
    ['dossiers', 'get', '/'],
  ]) {
    assert.equal(passeLesGardes(routeur, methode, chemin, IH).autorise, true, `inspecteur_hotellerie ${chemin}`);
    assert.equal(passeLesGardes(routeur, methode, chemin, ROLES.INSPECTEUR).autorise, false, `inspecteur ${chemin}`);
  }
  assert.equal(perimetreDossiers.perimetreDossiersPourRole(ROLES.INSPECTEUR), null);
  assert.ok(perimetreDossiers.perimetreDossiersPourRole(IH));
});

test('Droits de Formateur et Inspecteur inchangés sur les routes touchées par ce chantier', () => {
  const attendu = {
    // [routeur, méthode, chemin] : [formateur, inspecteur]
    'dossiers get /': [false, false],
    'dossiers get /:dossierId': [true, true],
    'dossiers get /:dossierId/evaluation': [false, false],
    'dossiers get /derniere-modification': [true, true],
    'rendezvous get /': [true, true],
    'formation get /': [true, true],
    'notes get /': [true, true],
    'notes post /': [true, true],
    'statistiques get /kpi': [false, false],
    'dpae post /': [false, false],
    'dpae get /tableau-de-bord': [false, false],
    'evaluations get /a-faire': [true, true],
  };
  for (const [cle, [formateur, inspecteur]] of Object.entries(attendu)) {
    const [routeur, methode, chemin] = cle.split(' ');
    assert.equal(passeLesGardes(routeur, methode, chemin, ROLES.FORMATEUR).autorise, formateur, `formateur ${cle}`);
    assert.equal(passeLesGardes(routeur, methode, chemin, ROLES.INSPECTEUR).autorise, inspecteur, `inspecteur ${cle}`);
  }
});

test('DPAE : Planning, RH et Admin gardent le tableau de bord DPAE et l’ajout de note', () => {
  for (const roleCode of [ROLES.PLANNING, ROLES.RH, ROLES.ADMIN]) {
    assert.equal(passeLesGardes('dpae', 'get', '/tableau-de-bord', roleCode).autorise, true, roleCode);
    assert.equal(passeLesGardes('dpae', 'post', '/:id/notes', roleCode).autorise, true, roleCode);
  }
});

// --- Périmètre de dossiers (Hôtellerie, 5 statuts) -----------------------------------------------------
test('Périmètre : Hôtellerie seulement, et uniquement les 5 statuts demandés', () => {
  assert.deepEqual(perimetreDossiers.perimetreDossiersPourRole(IH), {
    typePoste: 'hotel',
    statutsCodes: ['test_planifie', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche', 'invalide'],
  });
  for (const roleCode of [ROLES.ADMIN, ROLES.ACCUEIL_COORDINATION, ROLES.PLANNING, ROLES.RH, ROLES.FORMATEUR]) {
    assert.equal(perimetreDossiers.perimetreDossiersPourRole(roleCode), null, roleCode);
  }
});

test('Liste des dossiers : filtre Hôtellerie + 5 statuts appliqué EN BASE pour l’Inspecteur Hôtellerie, aucun filtre sinon', () => {
  const bd = knex({ client: 'pg' });
  const sqlAvec = dossierRepository.listerDossiers(bd, 1, { perimetre: perimetreDossiers.perimetreDossiersPourRole(IH) }).toString();
  assert.match(sqlAvec, /"statuts"\."code" in \('test_planifie', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche', 'invalide'\)/);
  assert.match(sqlAvec, /bloc_disponibilites\.donnees ->> 'typePoste' = 'hotel'/);
  const sqlSans = dossierRepository.listerDossiers(bd, 1, {}).toString();
  assert.doesNotMatch(sqlSans, /->> 'typePoste' = 'hotel'/);
});

function reponseFactice() {
  const res = { statut: 200, corps: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = (corps) => {
    res.corps = corps;
    return res;
  };
  return res;
}

function gestionnaire(nomRouteur, methode, chemin) {
  const couche = ROUTEURS[nomRouteur].stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  return couche.route.stack.at(-1).handle;
}

test('GET /api/dossiers : le service reçoit le périmètre de l’Inspecteur Hôtellerie, null pour l’Admin', async (t) => {
  const lister = t.mock.method(dossierService, 'listerDossiers', async () => []);
  for (const roleCode of [IH, ROLES.ADMIN]) {
    await gestionnaire('dossiers', 'get', '/')({ query: {}, entite: ENTITE, utilisateur: { id: 9, roleCode } }, reponseFactice(), assert.fail);
  }
  assert.equal(lister.mock.calls[0].arguments[1].perimetre.typePoste, 'hotel');
  assert.equal(lister.mock.calls[1].arguments[1].perimetre, null);
});

test('GET /api/dossiers/statuts : seuls les 5 statuts du périmètre sont renvoyés à l’Inspecteur Hôtellerie', async (t) => {
  const tous = ['nouveau', 'test_planifie', 'test_non_realise', 'invalide', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche', 'formation_non_validee'];
  t.mock.method(dossierService, 'listerStatuts', async () => tous.map((code) => ({ code })));
  const res = reponseFactice();
  await gestionnaire('dossiers', 'get', '/statuts')({ query: {}, entite: ENTITE, utilisateur: { id: 9, roleCode: IH } }, res, assert.fail);
  assert.deepEqual(res.corps.map((s) => s.code).sort(), ['embauche', 'invalide', 'test_planifie', 'valide_envoi_formation', 'valide_pret_embauche']);
});

test('Indicateurs : secteur Hôtellerie IMPOSÉ côté serveur pour l’Inspecteur Hôtellerie, même s’il demande Tertiaire', async (t) => {
  const kpi = t.mock.method(statistiquesService, 'obtenirIndicateursKpi', async () => ({}));
  const requete = (roleCode, typePoste) => ({
    query: { dateDebut: '2026-09-01', dateFin: '2026-09-30', ...(typePoste ? { typePoste } : {}) },
    entite: ENTITE,
    utilisateur: { id: 9, roleCode },
  });
  await gestionnaire('statistiques', 'get', '/kpi')(requete(IH, 'bureau'), reponseFactice(), assert.fail);
  await gestionnaire('statistiques', 'get', '/kpi')(requete(IH), reponseFactice(), assert.fail);
  await gestionnaire('statistiques', 'get', '/kpi')(requete(ROLES.ADMIN, 'bureau'), reponseFactice(), assert.fail);
  assert.deepEqual(kpi.mock.calls.map((appel) => appel.arguments[1].typePoste), ['hotel', 'hotel', 'bureau']);
});

// verifierPerimetreDossier (monté dans app.js sur /api/dossiers/:dossierId, AVANT les routeurs).
async function appelerPerimetre(t, { roleCode, dossierId, dansPerimetre }) {
  t.mock.method(db, 'obtenirKnex', async () => ({}));
  const verif = t.mock.method(perimetreDossiers, 'dossierDansPerimetre', async () => dansPerimetre);
  const res = reponseFactice();
  let suivant = false;
  await perimetreDossiers.verifierPerimetreDossier(
    { params: { dossierId }, entite: ENTITE, session: { utilisateur: { id: 9, roleCode, entiteId: ENTITE.id } } },
    res,
    () => {
      suivant = true;
    },
  );
  return { res, suivant, verif };
}

test('Fiche d’un dossier Tertiaire (ou hors des 5 statuts) par son numéro : 404 pour l’Inspecteur Hôtellerie', async (t) => {
  const { res, suivant } = await appelerPerimetre(t, { roleCode: IH, dossierId: '41', dansPerimetre: false });
  assert.equal(suivant, false);
  assert.equal(res.statut, 404);
});

test('Fiche d’un dossier Hôtellerie de son périmètre : la requête continue vers la route', async (t) => {
  const { suivant } = await appelerPerimetre(t, { roleCode: IH, dossierId: '135', dansPerimetre: true });
  assert.equal(suivant, true);
});

test('Autres rôles et segments nommés (statuts, rendezvous…) : aucune vérification de périmètre', async (t) => {
  for (const [roleCode, dossierId] of [[ROLES.ADMIN, '41'], [ROLES.INSPECTEUR, '41'], [IH, 'statuts']]) {
    const { suivant, verif } = await appelerPerimetre(t, { roleCode, dossierId, dansPerimetre: false });
    assert.equal(suivant, true, `${roleCode} ${dossierId}`);
    assert.equal(verif.mock.callCount(), 0, `${roleCode} ${dossierId}`);
  }
});

test('Périmètre en base : dossier de l’entité, statut parmi les 5 ET typePoste hotel (requête vérifiée)', () => {
  const bd = knex({ client: 'pg' });
  const sql = perimetreDossiers.requeteDossierDansPerimetre(bd, 1, 41, perimetreDossiers.perimetreDossiersPourRole(IH)).toString();
  assert.match(sql, /"dossiers"\."id" = 41/);
  assert.match(sql, /"dossiers"\."entite_id" = 1/);
  assert.match(sql, /"statuts"\."code" in \('test_planifie', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche', 'invalide'\)/);
  assert.match(sql, /bloc_disponibilites\.donnees ->> 'typePoste' = 'hotel'/);
});

// --- Onglet Admin « Vue Inspecteur Hôtellerie » : paramètre `vue`, Admin uniquement ------------------
test('Paramètre vue=inspecteur_hotellerie : appliqué pour l’Admin, IGNORÉ pour tout autre rôle', () => {
  const { perimetreDossiersPourRequete, perimetreDossiersPourRole } = perimetreDossiers;
  assert.deepEqual(perimetreDossiersPourRequete(ROLES.ADMIN, IH), perimetreDossiersPourRole(IH));
  assert.equal(perimetreDossiersPourRequete(ROLES.ADMIN, undefined), null);
  assert.equal(perimetreDossiersPourRequete(ROLES.ADMIN, 'inconnu'), null);
  assert.equal(perimetreDossiersPourRequete(ROLES.ADMIN, ROLES.ADMIN), null);
  for (const roleCode of [ROLES.ACCUEIL_COORDINATION, ROLES.PLANNING, ROLES.RH, ROLES.FORMATEUR, ROLES.INSPECTEUR]) {
    assert.equal(perimetreDossiersPourRequete(roleCode, IH), null, roleCode);
  }
  // Le rôle Inspecteur Hôtellerie garde SON périmètre, quel que soit le paramètre.
  assert.deepEqual(perimetreDossiersPourRequete(IH, undefined), perimetreDossiersPourRole(IH));
  assert.deepEqual(perimetreDossiersPourRequete(IH, ROLES.ADMIN), perimetreDossiersPourRole(IH));
});

test('GET /api/dossiers?vue=inspecteur_hotellerie : l’Admin ne reçoit que l’Hôtellerie et les 5 statuts ; RH, Planning, Accueil : paramètre ignoré', async (t) => {
  const lister = t.mock.method(dossierService, 'listerDossiers', async () => []);
  for (const roleCode of [ROLES.ADMIN, ROLES.RH, ROLES.PLANNING, ROLES.ACCUEIL_COORDINATION]) {
    await gestionnaire('dossiers', 'get', '/')({ query: { vue: IH }, entite: ENTITE, utilisateur: { id: 9, roleCode } }, reponseFactice(), assert.fail);
  }
  const perimetres = lister.mock.calls.map((appel) => appel.arguments[1].perimetre);
  assert.deepEqual(perimetres[0], perimetreDossiers.perimetreDossiersPourRole(IH));
  assert.deepEqual(perimetres.slice(1), [null, null, null]);
});

test('GET /api/dossiers/statuts?vue=inspecteur_hotellerie : 5 statuts pour l’Admin, tous pour un autre rôle', async (t) => {
  const tous = ['nouveau', 'test_planifie', 'test_non_realise', 'invalide', 'valide_envoi_formation', 'valide_pret_embauche', 'embauche'];
  t.mock.method(dossierService, 'listerStatuts', async () => tous.map((code) => ({ code })));
  const appeler = async (roleCode) => {
    const res = reponseFactice();
    await gestionnaire('dossiers', 'get', '/statuts')({ query: { vue: IH }, entite: ENTITE, utilisateur: { id: 9, roleCode } }, res, assert.fail);
    return res.corps.map((s) => s.code);
  };
  assert.deepEqual((await appeler(ROLES.ADMIN)).sort(), ['embauche', 'invalide', 'test_planifie', 'valide_envoi_formation', 'valide_pret_embauche']);
  assert.deepEqual(await appeler(ROLES.RH), tous);
});
