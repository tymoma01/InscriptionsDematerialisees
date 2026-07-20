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

// Jointure sur types_pieces pour exposer le code/libellé du type de pièce (pas seulement
// type_piece_id) — évite au consommateur de la liste (back-office) une seconde requête par ligne.
function listerPiecesParDossier(trx, dossierId) {
  return trx('pieces_justificatives')
    .join('types_pieces', 'types_pieces.id', 'pieces_justificatives.type_piece_id')
    .where({ 'pieces_justificatives.dossier_id': dossierId })
    .select(
      'pieces_justificatives.id',
      'pieces_justificatives.dossier_id',
      'pieces_justificatives.nom_fichier',
      'pieces_justificatives.statut_verification',
      'pieces_justificatives.uploaded_by',
      'pieces_justificatives.date_upload',
      'pieces_justificatives.date_verification',
      'types_pieces.code as type_piece_code',
      'types_pieces.libelle as type_piece_libelle',
    )
    .orderBy('pieces_justificatives.date_upload', 'desc');
}

function mettreAJourStatutVerification(trx, pieceId, { statutVerification, dateVerification }) {
  return trx('pieces_justificatives')
    .where({ id: pieceId })
    .update({ statut_verification: statutVerification, date_verification: dateVerification })
    .returning('*')
    .then(([piece]) => piece);
}

module.exports = {
  trouverTypePieceParCode,
  enregistrerPieceJustificative,
  trouverPieceJustificativeParId,
  supprimerPieceJustificativeParId,
  listerPiecesParDossier,
  mettreAJourStatutVerification,
};
