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
