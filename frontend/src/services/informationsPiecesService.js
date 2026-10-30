import api from './api';

// Pièce d'identité et RIB du candidat, lus par OCR à la tablette puis confirmés par l'accueil
// (voir backend/src/api/routes/informationsPieces.routes.js).

export async function obtenirInformationsPieces(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/informations-pieces`);
  return data;
}

export async function confirmerPieceIdentite(dossierId, piece) {
  const { data } = await api.put(`/dossiers/${dossierId}/informations-pieces/piece-identite`, piece);
  return data.pieceIdentite;
}

export async function confirmerRib(dossierId, rib) {
  const { data } = await api.put(`/dossiers/${dossierId}/informations-pieces/rib`, rib);
  return data.rib;
}

// « Renseigner plus tard » : la pièce passe à « informations à compléter », rien n'est exigé.
export async function reporterPieceIdentite(dossierId) {
  await api.put(`/dossiers/${dossierId}/informations-pieces/piece-identite/plus-tard`);
}

export async function reporterRib(dossierId) {
  await api.put(`/dossiers/${dossierId}/informations-pieces/rib/plus-tard`);
}
