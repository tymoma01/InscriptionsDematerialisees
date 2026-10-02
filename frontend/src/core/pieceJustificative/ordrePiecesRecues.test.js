// Tests de l'ordre du bloc « Pièces jointes » (ordrePiecesRecues.js) — lancés par `npm test` (Vitest).
import { expect, test } from 'vitest';
import { ordonnerPiecesRecues } from './ordrePiecesRecues.js';

// Configuration des pièces telle que GET /api/types-pieces la renvoie pour ACCECIT (ordre et libellés
// de la migration 076 côté backend ; le verso n'est pas un type affiché, seulement un codeVerso).
const typesPiecesConfigAccecitTest = [
  { code: 'photo_identite', libelle: "Photo d'identité", obligatoire: true, captureUniquement: true, multiple: false },
  { code: 'carte_identite', libelle: "Carte d'identité ou Carte de Séjour", obligatoire: true, captureUniquement: false, multiple: false, codeVerso: 'carte_identite_verso' },
  { code: 'carte_vitale', libelle: 'Carte Vitale ou Attestation de Sécurité Sociale', obligatoire: true, captureUniquement: false, multiple: false },
  { code: 'rib', libelle: "Relevé d'identité bancaire (RIB)", obligatoire: true, captureUniquement: false, multiple: false },
  { code: 'justificatif_domicile', libelle: 'Justificatif de domicile', obligatoire: true, captureUniquement: false, multiple: false },
  { code: 'justificatif_experience', libelle: "Justificatif d'expériences", obligatoire: false, captureUniquement: false, multiple: false },
  { code: 'attestation_mutuelle', libelle: 'Attestation Mutuelle', obligatoire: false, captureUniquement: false, multiple: false },
  { code: 'autres', libelle: 'Autres documents', obligatoire: false, captureUniquement: false, multiple: true },
];

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
  expect(lignes.map((l) => [l.libelle, l.verso, l.piece.date_upload.slice(11, 16)])).toStrictEqual([
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
    ]);
  expect(lignes[2].libelleApercu).toBe("Verso - Carte d'identité ou Carte de Séjour");
});

test('Seules les pièces reçues : même nombre de lignes que de pièces, aucune ligne pour un type absent', () => {
  const partiel = [piece('rib', '2026-10-02T09:00:00Z'), piece('photo_identite', '2026-10-02T08:00:00Z')];
  const lignes = ordonnerPiecesRecues(partiel, typesPiecesConfigAccecitTest);
  expect(lignes.map((l) => l.libelle)).toStrictEqual(["Photo d'identité", "Relevé d'identité bancaire (RIB)"]);
  expect(ordonnerPiecesRecues(DOSSIER_COMPLET, typesPiecesConfigAccecitTest).length).toBe(DOSSIER_COMPLET.length);
  expect(ordonnerPiecesRecues([], typesPiecesConfigAccecitTest)).toStrictEqual([]);
});

test('Type inconnu de la configuration : jamais masqué, libellé du serveur, avant les autres documents', () => {
  const lignes = ordonnerPiecesRecues(
    [piece('autres', '2026-10-02T08:00:00Z'), piece('type_futur', '2026-10-02T09:00:00Z', 'Permis de conduire'), piece('rib', '2026-10-02T10:00:00Z')],
    typesPiecesConfigAccecitTest,
  );
  expect(lignes.map((l) => l.libelle)).toStrictEqual(["Relevé d'identité bancaire (RIB)", 'Permis de conduire', 'Autres documents']);
});
