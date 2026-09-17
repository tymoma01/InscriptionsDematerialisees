const test = require('node:test');
const assert = require('node:assert/strict');

const evaluationRepository = require('./evaluationRepository');

// construireCreneauxDisponibles (audit 2026-09-18, correctif) — fonction pure (aucun accès DB),
// couvre le bug signalé : matin/midi/soir (vocabulaire hôtel) remontaient dans le select "Créneaux
// souhaités" de l'Inspecteur alors que ce rôle reste cantonné au secteur bureau, à cause de lignes
// incohérentes en base (rien n'empêche un dossier bureau de contenir un code hôtel dans son
// `creneaux`, seule la validation Zod à l'écriture l'interdit, pas une contrainte SQL).
test('construireCreneauxDisponibles (secteur bureau) ne renvoie jamais matin/midi/soir, même si des lignes incohérentes en base en contiennent', () => {
  const lignes = [
    { creneaux: ['6h-9h', '9h-18h'] },
    // Ligne incohérente : typePoste bureau mais creneaux contient un code hôtel (voir commentaire
    // de la fonction testée) — c'est précisément ce cas qui causait le bug signalé.
    { creneaux: ['matin', 'midi'] },
    { creneaux: null },
  ];

  const resultat = evaluationRepository.construireCreneauxDisponibles(lignes, 'bureau');

  assert.deepEqual(resultat, ['6h-9h', '9h-18h']);
  assert.ok(!resultat.includes('matin'));
  assert.ok(!resultat.includes('midi'));
  assert.ok(!resultat.includes('soir'));
});

test('construireCreneauxDisponibles (secteur bureau) renvoie les créneaux dans l’ordre chronologique du vocabulaire, pas un tri alphabétique', () => {
  // '18h-21h' est reçu EN PREMIER ici, et trierait avant '6h-9h' en comparaison de chaînes
  // (bug signalé, audit 2026-09-18) — l'ordre attendu suit le vocabulaire, pas l'ordre des lignes
  // ni un tri alphabétique.
  const lignes = [{ creneaux: ['18h-21h'] }, { creneaux: ['6h-9h'] }, { creneaux: ['9h-18h'] }];

  const resultat = evaluationRepository.construireCreneauxDisponibles(lignes, 'bureau');

  assert.deepEqual(resultat, ['6h-9h', '9h-18h', '18h-21h']);
});

test("construireCreneauxDisponibles (secteur bureau) n'inclut pas une valeur du vocabulaire jamais observée en base", () => {
  const lignes = [{ creneaux: ['6h-9h'] }];

  const resultat = evaluationRepository.construireCreneauxDisponibles(lignes, 'bureau');

  assert.deepEqual(resultat, ['6h-9h']);
});

test('construireCreneauxDisponibles (secteur hôtel) restreint symétriquement au vocabulaire hôtel', () => {
  const lignes = [{ creneaux: ['soir', 'matin'] }, { creneaux: ['6h-9h'] }];

  const resultat = evaluationRepository.construireCreneauxDisponibles(lignes, 'hotel');

  assert.deepEqual(resultat, ['matin', 'soir']);
});

test('construireCreneauxDisponibles (typePoste null) ne restreint à aucun vocabulaire (aucun appelant actuel, mais comportement défini)', () => {
  const lignes = [{ creneaux: ['soir'] }, { creneaux: ['6h-9h'] }];

  const resultat = evaluationRepository.construireCreneauxDisponibles(lignes, null);

  assert.deepEqual(resultat, ['6h-9h', 'soir']);
});
