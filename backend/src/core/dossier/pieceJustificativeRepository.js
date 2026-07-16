// Accès données pour les pièces justificatives — uniquement des requêtes, aucune règle métier
// ici (orchestrée par pieceJustificativeService.js), même découpage que dossierRepository.js.

function trouverTypePieceParCode(trx, entiteId, code) {
  return trx('types_pieces').where({ entite_id: entiteId, code }).first();
}

async function enregistrerPieceJustificative(trx, { dossierId, typePieceId, referenceStockage, nomFichier, uploadedBy }) {
  const [piece] = await trx('pieces_justificatives')
    .insert({
      dossier_id: dossierId,
      type_piece_id: typePieceId,
      reference_stockage: referenceStockage,
      nom_fichier: nomFichier,
      uploaded_by: uploadedBy,
    })
    .returning('id');
  return piece.id;
}

function trouverPieceJustificativeParId(trx, pieceId) {
  return trx('pieces_justificatives').where({ id: pieceId }).first();
}

function supprimerPieceJustificativeParId(trx, pieceId) {
  return trx('pieces_justificatives').where({ id: pieceId }).del();
}

module.exports = {
  trouverTypePieceParCode,
  enregistrerPieceJustificative,
  trouverPieceJustificativeParId,
  supprimerPieceJustificativeParId,
};
