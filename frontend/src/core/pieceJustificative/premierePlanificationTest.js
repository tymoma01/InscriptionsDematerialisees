// Condition d'affichage du bouton "Valider et planifier un test" — partagée entre
// CaptureTablette.jsx (onglet "Pièces justificatives", où ce bouton vivait jusque-là seul) et
// Tests.jsx (onglet "Tests", qui le propose désormais aussi dès que cette même condition est
// remplie, sans obliger l'agent à repasser par l'onglet Pièces — voir son commentaire d'en-tête).
// Isolée dans son propre module plutôt que dupliquée dans les deux écrans : ce sont les DEUX
// conditions (statut du dossier + complétude des pièces obligatoires) qui déclenchent une action
// réelle (créer un rendez-vous), jamais un simple mapping cosmétique — les laisser diverger d'un
// onglet à l'autre exposerait le bouton dans un cas où l'autre ne le ferait pas.

// Statuts sous lesquels un premier test n'a encore jamais été planifié pour ce dossier — copie
// exacte de l'ancien nom local STATUTS_DOSSIER_PIECES_MODIFIABLES (CaptureTablette.jsx).
// test_non_planifie (workflow v5, audit 2026-08-21) : la transition automatique
// 'pieces_completes' fait désormais quitter en_attente_pieces dès la dernière pièce obligatoire
// capturée, avant même que le test soit planifié — sans cet ajout, le bouton disparaîtrait juste
// au moment où il doit devenir utile.
export const STATUTS_TEST_NON_PLANIFIE = ['en_attente_pieces', 'test_non_planifie'];

// Une seule ligne par type de pièce, la plus récente (les pièces viennent triées date_upload
// desc, voir pieceJustificativeRepository.listerPiecesParDossier) — même construction que
// CaptureTablette.jsx utilisait déjà en dur avant cette extraction.
export function construirePiecesCapturees(pieces) {
  const parType = new Map();
  pieces.forEach((piece) => {
    if (!parType.has(piece.type_piece_code)) parType.set(piece.type_piece_code, piece);
  });
  return parType;
}

// Seules les pièces obligatoires conditionnent le bouton de planification — les pièces
// optionnelles (RIB, justificatif de domicile, justificatif d'expérience, attestation mutuelle,
// voir typesPiecesConfig.accecit.js) n'ont jamais besoin d'être capturées pour avancer le
// dossier.
export function calculerPiecesObligatoiresCompletes(piecesCapturees, typesPieces) {
  const piecesObligatoires = typesPieces.filter((type) => type.obligatoire);
  return {
    nombrePiecesObligatoires: piecesObligatoires.length,
    piecesObligatoiresCompletes: piecesObligatoires.every((type) => piecesCapturees.has(type.code)),
  };
}
