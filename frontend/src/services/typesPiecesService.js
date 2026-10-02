import api from './api';

// Liste des pièces justificatives de l'entité (table types_pieces, voir
// backend/src/api/routes/typesPieces.routes.js).
export async function listerTypesPieces() {
  const { data } = await api.get('/types-pieces');
  return data.typesPieces;
}
