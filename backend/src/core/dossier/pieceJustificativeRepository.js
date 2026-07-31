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

// Scopé par entiteId (jointure vers dossiers) : un pieceId est un entier séquentiel, donc
// devinable/énumérable — sans ce filtre, un utilisateur authentifié d'une entité pourrait
// accéder à une pièce (CNI, RIB...) d'une autre entité en devinant son id. Retourne undefined
// aussi bien si la pièce n'existe pas que si elle appartient à une autre entité : le même
// message "introuvable" est renvoyé au client dans les deux cas (voir pieceJustificativeService.js),
// pour ne pas laisser fuiter l'information qu'un id existe ailleurs.
function trouverPieceJustificativeParId(trx, entiteId, pieceId) {
  return trx('pieces_justificatives')
    .join('dossiers', 'dossiers.id', 'pieces_justificatives.dossier_id')
    .where({ 'pieces_justificatives.id': pieceId, 'dossiers.entite_id': entiteId })
    .select('pieces_justificatives.*')
    .first();
}

function supprimerPieceJustificativeParId(trx, pieceId) {
  return trx('pieces_justificatives').where({ id: pieceId }).del();
}

// Utilisée par pieceJustificativeService.uploaderPieceJustificative pour distinguer, une fois le
// test planifié, l'ajout d'une pièce encore jamais capturée (toléré) du remplacement d'une pièce
// déjà présente (interdit, même via l'API directement — voir STATUTS_AJOUT_PIECE_MANQUANTE_AUTORISES).
function trouverPieceParDossierEtType(trx, dossierId, typePieceId) {
  return trx('pieces_justificatives').where({ dossier_id: dossierId, type_piece_id: typePieceId }).first();
}

// Jointure sur types_pieces pour exposer le code/libellé du type de pièce (pas seulement
// type_piece_id) — évite au consommateur de la liste (back-office) une seconde requête par ligne.
// dossierId est déjà vérifié comme appartenant à l'entité par pieceJustificativeService (via
// dossierRepository.trouverDossierParId) avant d'appeler cette fonction — pas de filtre entiteId
// redondant ici, cohérent avec le principe "vérifier une fois, à l'entrée du service".
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

// Variante de listerPiecesParDossier incluant reference_stockage — jamais exposée telle quelle
// au front (GET .../pieces normal n'en a pas besoin, voir listerPiecesParDossier ci-dessus) :
// réservée à un usage interne serveur qui doit effectivement récupérer le contenu de chaque
// fichier (export ZIP groupé, voir pieceJustificativeService.telechargerToutesPiecesJustificatives).
function listerPiecesAvecReferenceParDossier(trx, dossierId) {
  return trx('pieces_justificatives')
    .join('types_pieces', 'types_pieces.id', 'pieces_justificatives.type_piece_id')
    .where({ 'pieces_justificatives.dossier_id': dossierId })
    .select(
      'pieces_justificatives.id',
      'pieces_justificatives.nom_fichier',
      'pieces_justificatives.reference_stockage',
      'types_pieces.code as type_piece_code',
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
  trouverPieceParDossierEtType,
  listerPiecesParDossier,
  listerPiecesAvecReferenceParDossier,
  mettreAJourStatutVerification,
};
