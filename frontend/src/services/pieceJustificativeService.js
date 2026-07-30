import api from './api';

// Service dédié aux pièces justificatives — encapsule les appels réseau pour que
// CaptureTablette.jsx n'ait pas à connaître la forme exacte de l'API back-end.

export async function listerPiecesJustificatives(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/pieces`);
  return data;
}

// uploadedBy n'est jamais envoyé ici : le back le dérive de la session serveur de l'agent
// connecté (voir backend/src/api/routes/pieces.routes.js et CLAUDE.auth-rbac.md) — un champ
// manuel serait trivialement falsifiable par le client, c'est justement ce qui a été corrigé.
export async function uploaderPieceJustificative(dossierId, { typePieceCode, fichier, nomFichier }) {
  const formData = new FormData();
  formData.append('typePieceCode', typePieceCode);
  formData.append('piece', fichier, nomFichier ?? fichier.name ?? 'piece');

  const { data } = await api.post(`/dossiers/${dossierId}/pieces`, formData, {
    // L'instance `api` fixe Content-Type: application/json par défaut (voir services/api.js) —
    // sans cette surcharge, ce header par défaut écraserait le multipart/form-data attendu par
    // multer (pas de boundary), et req.file resterait vide côté back. undefined retire le header
    // du merge axios : le navigateur peut alors poser lui-même le bon Content-Type + boundary.
    headers: { 'Content-Type': undefined },
  });
  return data;
}

// Le back refuse déjà la suppression si le dossier n'est plus en_attente_pieces (voir
// pieceJustificativeService.js, STATUTS_SUPPRESSION_AUTORISES) — CaptureTablette.jsx applique la
// même règle en amont pour ne même pas afficher le bouton, mais ce service ne la duplique pas.
export async function supprimerPieceJustificative(dossierId, pieceId) {
  await api.delete(`/dossiers/${dossierId}/pieces/${pieceId}`);
}
