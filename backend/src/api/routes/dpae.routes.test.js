const test = require('node:test');
const assert = require('node:assert/strict');

const dpaeRouter = require('./dpae.routes');

const { demandeBodySchema } = dpaeRouter;

// Champ "Hôtel" obligatoire côté serveur (audit 2026-09-29) — testé sur le VRAI schéma monté sur
// POST /api/dpae (exporté par dpae.routes.js, même convention que dossiers.routes.test.js).
const DEMANDE_VALIDE = {
  typeDemande: 'nouvelle_embauche',
  salarieNom: 'Martin',
  salariePrenom: 'Léa',
  salarieDejaEmploye: false,
  hotel: 'Hôtel du Cadran',
  verifBesoinHotel: true,
  verifTousJoursInclus: true,
  verifNonPlanification: true,
};

test('POST /api/dpae : une demande avec un hôtel renseigné est acceptée (hôtel conservé, sans espaces superflus)', () => {
  const resultat = demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, hotel: '  Hôtel du Cadran  ' });
  assert.equal(resultat.success, true);
  assert.equal(resultat.data.hotel, 'Hôtel du Cadran');
});

test('POST /api/dpae : hôtel absent, vide ou fait d\'espaces -> refusé avec un message explicite', () => {
  const { hotel: _hotel, ...sansHotel } = DEMANDE_VALIDE;
  for (const [cas, donnees] of [
    ['absent', sansHotel],
    ['vide', { ...DEMANDE_VALIDE, hotel: '' }],
    ['espaces', { ...DEMANDE_VALIDE, hotel: '   ' }],
  ]) {
    const resultat = demandeBodySchema.safeParse(donnees);
    assert.equal(resultat.success, false, cas);
    assert.ok(resultat.error.flatten().fieldErrors.hotel, `${cas} : erreur attendue sur le champ hotel`);
  }
  assert.deepEqual(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, hotel: '' }).error.flatten().fieldErrors.hotel, [
    "L'hôtel est obligatoire.",
  ]);
});

test("POST /api/dpae : le champ Entité (division) reste facultatif (inchangé)", () => {
  assert.equal(demandeBodySchema.safeParse(DEMANDE_VALIDE).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, division: '' }).success, true);
  assert.equal(demandeBodySchema.safeParse({ ...DEMANDE_VALIDE, division: 'acchot' }).success, true);
});
