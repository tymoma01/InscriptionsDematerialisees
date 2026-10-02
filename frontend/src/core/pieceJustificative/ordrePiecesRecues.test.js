// Tests de l'ordre du bloc « Pièces jointes » (ordrePiecesRecues.js) — lancés par `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordonnerPiecesRecues } from './ordrePiecesRecues.js';
import { typesPiecesConfigAccecitTest } from './donneesTest/typesPiecesConfig.accecit.js';

let prochainId = 1;
const piece = (code, dateUpload, libelleServeur = `libellé serveur ${code}`) => ({
  id: prochainId++,
  type_piece_code: code,
  type_piece_libelle: libelleServeur,
  date_upload: dateUpload,
});

// Dossier complet, reçu dans le désordre (le serveur renvoie la plus récente en tête).
const DOSSIER_COMPLET = [
  piece('autres', '2026-10-02T10:00:00Z'),
  piece('attestation_mutuelle', '2026-10-02T09:50:00Z'),
  piece('carte_identite_verso', '2026-10-02T09:40:00Z'),
  piece('rib', '2026-10-02T09:30:00Z'),
  piece('autres', '2026-10-02T09:20:00Z'),
  piece('justificatif_experience', '2026-10-02T09:10:00Z'),
  piece('justificatif_domicile', '2026-10-02T09:00:00Z'),
  piece('carte_vitale', '2026-10-02T08:50:00Z'),
  piece('carte_identite', '2026-10-02T08:40:00Z'),
  piece('photo_identite', '2026-10-02T08:30:00Z'),
];

test('Ordre et libellés du bloc « Pièces justificatives » ; verso juste sous la carte d’identité ; autres documents à la fin, ordre de réception', () => {
  const lignes = ordonnerPiecesRecues(DOSSIER_COMPLET, typesPiecesConfigAccecitTest);
  assert.deepEqual(
    lignes.map((l) => [l.libelle, l.verso, l.piece.date_upload.slice(11, 16)]),
    [
      ["Photo d'identité", false, '08:30'],
      ["Carte d'identité ou Carte de Séjour", false, '08:40'],
      ['Verso (optionnel)', true, '09:40'],
      ['Carte Vitale ou Attestation de Sécurité Sociale', false, '08:50'],
      ["Relevé d'identité bancaire (RIB)", false, '09:30'],
      ['Justificatif de domicile', false, '09:00'],
      ["Justificatif d'expériences", false, '09:10'],
      ['Attestation Mutuelle', false, '09:50'],
      ['Autres documents', false, '09:20'],
      ['Autres documents', false, '10:00'],
    ],
  );
  assert.equal(lignes[2].libelleApercu, "Verso - Carte d'identité ou Carte de Séjour");
});

test('Seules les pièces reçues : même nombre de lignes que de pièces, aucune ligne pour un type absent', () => {
  const partiel = [piece('rib', '2026-10-02T09:00:00Z'), piece('photo_identite', '2026-10-02T08:00:00Z')];
  const lignes = ordonnerPiecesRecues(partiel, typesPiecesConfigAccecitTest);
  assert.deepEqual(lignes.map((l) => l.libelle), ["Photo d'identité", "Relevé d'identité bancaire (RIB)"]);
  assert.equal(ordonnerPiecesRecues(DOSSIER_COMPLET, typesPiecesConfigAccecitTest).length, DOSSIER_COMPLET.length);
  assert.deepEqual(ordonnerPiecesRecues([], typesPiecesConfigAccecitTest), []);
});

test('Type inconnu de la configuration : jamais masqué, libellé du serveur, avant les autres documents', () => {
  const lignes = ordonnerPiecesRecues(
    [piece('autres', '2026-10-02T08:00:00Z'), piece('type_futur', '2026-10-02T09:00:00Z', 'Permis de conduire'), piece('rib', '2026-10-02T10:00:00Z')],
    typesPiecesConfigAccecitTest,
  );
  assert.deepEqual(lignes.map((l) => l.libelle), ["Relevé d'identité bancaire (RIB)", 'Permis de conduire', 'Autres documents']);
});
