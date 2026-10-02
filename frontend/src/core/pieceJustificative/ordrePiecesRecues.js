// Ordre d'affichage des pièces REÇUES d'un dossier (2026-10-02) — bloc « Pièces jointes » de
// InformationsInscription.jsx, aligné sur le bloc « Pièces justificatives » (CaptureTablette.jsx).
// L'ordre et les libellés ne sont pas recopiés ici : ils viennent de la même configuration que
// CaptureTablette (typesPieces, donneesTest/typesPiecesConfig.accecit.js), passée en paramètre.
// Module pur (aucune dépendance React), testé par ordrePiecesRecues.test.js (npm test).
//
// Règles :
//   - types classiques dans l'ordre de la configuration, avec leur libellé de configuration ;
//   - verso d'un type (propriété codeVerso, ex. carte_identite_verso) juste après lui ;
//   - type absent de la configuration (cas imprévu) : jamais masqué, libellé du serveur, après
//     les types classiques ;
//   - types `multiple` (« Autres documents ») tout à la fin, dans leur ordre de réception.
// Seules les pièces reçues sont listées : aucune ligne pour un type sans pièce.

// Libellé du verso dans « Pièces jointes » (affiché sous sa pièce, en retrait).
export const LIBELLE_VERSO = 'Verso (optionnel)';

// Ordre de réception : la plus ancienne d'abord (le serveur renvoie la plus récente en tête).
function parReception(a, b) {
  return new Date(a.date_upload) - new Date(b.date_upload) || a.id - b.id;
}

// Renvoie [{ piece, libelle, libelleApercu, verso }] — libelleApercu : titre du panneau d'aperçu
// (« Verso - Carte d'identité… » pour un verso, comme CaptureTablette.jsx).
export function ordonnerPiecesRecues(pieces, typesPieces) {
  const restantes = new Map();
  for (const piece of pieces) {
    const liste = restantes.get(piece.type_piece_code) ?? [];
    liste.push(piece);
    restantes.set(piece.type_piece_code, liste);
  }
  const prendre = (code) => {
    const liste = [...(restantes.get(code) ?? [])].sort(parReception);
    restantes.delete(code);
    return liste;
  };

  const lignes = [];
  const typesMultiples = typesPieces.filter((type) => type.multiple);
  for (const type of typesPieces.filter((type) => !type.multiple)) {
    for (const piece of prendre(type.code)) lignes.push({ piece, libelle: type.libelle, libelleApercu: type.libelle, verso: false });
    if (type.codeVerso) {
      for (const piece of prendre(type.codeVerso)) {
        lignes.push({ piece, libelle: LIBELLE_VERSO, libelleApercu: `Verso - ${type.libelle}`, verso: true });
      }
    }
  }

  const codesMultiples = new Set(typesMultiples.map((type) => type.code));
  for (const piece of [...pieces].sort(parReception)) {
    if (restantes.has(piece.type_piece_code) && !codesMultiples.has(piece.type_piece_code)) {
      lignes.push({ piece, libelle: piece.type_piece_libelle, libelleApercu: piece.type_piece_libelle, verso: false });
    }
  }

  for (const type of typesMultiples) {
    for (const piece of prendre(type.code)) lignes.push({ piece, libelle: type.libelle, libelleApercu: type.libelle, verso: false });
  }
  return lignes;
}
