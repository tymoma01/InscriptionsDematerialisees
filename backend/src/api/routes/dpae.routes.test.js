const test = require('node:test');
const assert = require('node:assert/strict');

const dpaeRouter = require('./dpae.routes');

const { demandeBodySchema } = dpaeRouter;

// Testé sur le VRAI schéma monté sur POST /api/dpae (exporté par dpae.routes.js, même convention
// que dossiers.routes.test.js).
const DEMANDE_VALIDE = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Léa',
  salarieDejaEmploye: false,
  sitesAffectationIds: [10],
  verifBesoinHotel: true,
  verifTousJoursInclus: true,
  verifNonPlanification: true,
};

const MESSAGE_SITES_OBLIGATOIRES = "Au moins un site d'affectation est obligatoire.";

// Site(s) d'affectation (référentiel, migration 069, 2026-09-29) — remplace l'ancien champ texte
// `hotel` obligatoire. L'existence/l'état actif/l'entité de chaque id sont vérifiés par le service
// (voir demandeDpaeService.test.js), ce schéma ne garantit que la forme de la liste.
test("POST /api/dpae : un site d'affectation -> accepté ; plusieurs sites -> acceptés, tous conservés", () => {
  assert.deepEqual(demandeBodySchema.parse(DEMANDE_VALIDE).sitesAffectationIds, [10]);
  assert.deepEqual(demandeBodySchema.parse({ ...DEMANDE_VALIDE, sitesAffectationIds: [10, 11, 12] }).sitesAffectationIds, [10, 11, 12]);
});

test("POST /api/dpae : liste de sites vide ou absente -> refus « Au moins un site d'affectation est obligatoire. »", () => {
  const { sitesAffectationIds: _ids, ...sansSites } = DEMANDE_VALIDE;
  for (const [cas, donnees] of [
    ['vide', { ...DEMANDE_VALIDE, sitesAffectationIds: [] }],
    ['absente', sansSites],
  ]) {
    const resultat = demandeBodySchema.safeParse(donnees);
    assert.equal(resultat.success, false, cas);
    assert.deepEqual(resultat.error.flatten().fieldErrors.sitesAffectationIds, [MESSAGE_SITES_OBLIGATOIRES], cas);
  }
});

test('POST /api/dpae : un même site deux fois dans la liste -> refus', () => {
  const resultat = demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, sitesAffectationIds: [10, 11, 10] });
  assert.equal(resultat.success, false);
  assert.deepEqual(resultat.error.flatten().fieldErrors.sitesAffectationIds, [
    "Un même site d'affectation ne peut pas être sélectionné deux fois.",
  ]);
});

test("POST /api/dpae : l'ancien champ texte hotel n'est plus exigé (toléré s'il est fourni)", () => {
  assert.equal(demandeBodySchema.safeParse(DEMANDE_VALIDE).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, hotel: 'Hôtel du Cadran' }).success, true);
});

test("POST /api/dpae : le champ Entité (division) reste facultatif (inchangé)", () => {
  assert.equal(demandeBodySchema.safeParse(DEMANDE_VALIDE).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, division: '' }).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, division: 'acchot' }).success, true);
});

// "Nom du salarié remplacé" obligatoire uniquement pour un CDD de remplacement (audit 2026-09-29).
const MESSAGE_SALARIE_REMPLACE = 'Le nom du salarié remplacé est obligatoire pour un CDD de remplacement.';
const CDD_REMPLACEMENT = { ...DEMANDE_VALIDE, typeContrat: 'cdd', motifCdd: 'remplacement_absent' };

test('POST /api/dpae : CDD de remplacement sans nom du salarié remplacé (absent, vide ou espaces) -> refusé avec le message dédié', () => {
  for (const [cas, donnees] of [
    ['absent', CDD_REMPLACEMENT],
    ['vide', { ...CDD_REMPLACEMENT, salarieRemplaceNom: '' }],
    ['espaces', { ...CDD_REMPLACEMENT, salarieRemplaceNom: '   ' }],
  ]) {
    const resultat = demandeBodySchema.safeParse(donnees);
    assert.equal(resultat.success, false, cas);
    assert.deepEqual(resultat.error.flatten().fieldErrors.salarieRemplaceNom, [MESSAGE_SALARIE_REMPLACE], cas);
  }
});

test("POST /api/dpae : CDD de remplacement avec nom du salarié remplacé -> accepté (date de fin d'absence toujours facultative)", () => {
  const resultat = demandeBodySchema.safeParse({ ...CDD_REMPLACEMENT, salarieRemplaceNom: ' Dupont ' });
  assert.equal(resultat.success, true);
  assert.equal(resultat.data.salarieRemplaceNom, 'Dupont');
  assert.equal(resultat.data.dateFinAbsence, undefined);
});

test("POST /api/dpae : CDD de surcroît d'activité sans nom du salarié remplacé -> accepté", () => {
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, typeContrat: 'cdd', motifCdd: 'surcroit_activite' }).success, true);
});

test('POST /api/dpae : CDI sans nom du salarié remplacé -> accepté (même si une raison de CDD traîne dans la demande)', () => {
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, typeContrat: 'cdi' }).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, typeContrat: 'cdi', motifCdd: 'remplacement_absent' }).success, true);
});

// ---------------------------------------------------------------------------------------------
// Périmètre des rôles DPAE (2026-09-30) — testé sur les VRAIES gardes montées sur chaque route :
// on lit la pile du routeur Express et on exécute le premier middleware de la route (requireRole),
// jamais une copie des listes de rôles. Aucune infrastructure de test HTTP dans ce projet.
// ---------------------------------------------------------------------------------------------
function gardeRoute(methode, chemin) {
  const couche = dpaeRouter.stack.find((c) => c.route && c.route.path === chemin && c.route.methods[methode]);
  assert.ok(couche, `route ${methode.toUpperCase()} ${chemin} introuvable`);
  return couche.route.stack[0].handle;
}

function executerGarde(garde, roleCode) {
  const res = { statut: null };
  res.status = (code) => {
    res.statut = code;
    return res;
  };
  res.json = () => res;
  let autorise = false;
  garde({ utilisateur: { id: 1, roleCode } }, res, () => {
    autorise = true;
  });
  return { autorise, statut: res.statut };
}

const ACTIONS_DPAE = {
  'création (POST /)': ['post', '/'],
  'liste de suivi (GET /suivi)': ['get', '/suivi'],
  'fiche (GET /:id)': ['get', '/:id'],
  'file RH (GET /)': ['get', '/'],
  'validation RH (PATCH /:id/valider)': ['patch', '/:id/valider'],
  'rejet RH (PATCH /:id/rejeter)': ['patch', '/:id/rejeter'],
};

test("DPAE : l'Admin passe la garde de CHAQUE route (création, liste, fiche, file RH, validation, rejet)", () => {
  for (const [action, [methode, chemin]] of Object.entries(ACTIONS_DPAE)) {
    assert.equal(executerGarde(gardeRoute(methode, chemin), 'admin').autorise, true, action);
  }
});

test('DPAE : Accueil/Coordination reçoit 403 sur la création, la liste, la fiche et le traitement', () => {
  for (const [action, [methode, chemin]] of Object.entries(ACTIONS_DPAE)) {
    const { autorise, statut } = executerGarde(gardeRoute(methode, chemin), 'accueil_coordination');
    assert.equal(autorise, false, action);
    assert.equal(statut, 403, action);
  }
});

test('DPAE : création réservée à Planning et Admin (RH, Formateur, Inspecteur refusés)', () => {
  const garde = gardeRoute('post', '/');
  for (const roleCode of ['planning', 'admin']) assert.equal(executerGarde(garde, roleCode).autorise, true, roleCode);
  for (const roleCode of ['rh', 'formateur', 'inspecteur', 'accueil_coordination']) {
    assert.equal(executerGarde(garde, roleCode).statut, 403, roleCode);
  }
});

test('DPAE : liste de suivi et fiche ouvertes à Admin, RH et Planning ; fermées aux autres rôles', () => {
  for (const chemin of ['/suivi', '/:id']) {
    const garde = gardeRoute('get', chemin);
    for (const roleCode of ['admin', 'rh', 'planning']) assert.equal(executerGarde(garde, roleCode).autorise, true, `${chemin} ${roleCode}`);
    for (const roleCode of ['accueil_coordination', 'formateur', 'inspecteur']) {
      assert.equal(executerGarde(garde, roleCode).statut, 403, `${chemin} ${roleCode}`);
    }
  }
});

test('DPAE : traitement RH (file, validation, rejet) réservé à RH et Admin', () => {
  for (const [methode, chemin] of [['get', '/'], ['patch', '/:id/valider'], ['patch', '/:id/rejeter']]) {
    const garde = gardeRoute(methode, chemin);
    for (const roleCode of ['rh', 'admin']) assert.equal(executerGarde(garde, roleCode).autorise, true, `${chemin} ${roleCode}`);
    for (const roleCode of ['planning', 'accueil_coordination', 'formateur']) {
      assert.equal(executerGarde(garde, roleCode).statut, 403, `${chemin} ${roleCode}`);
    }
  }
});
