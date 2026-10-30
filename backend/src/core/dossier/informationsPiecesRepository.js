// Informations de la pièce d'identité et du RIB du candidat d'un dossier (migrations 088 et 090). Scopé
// par entiteId comme trouverDossierParId : undefined si le dossier n'appartient pas à l'entité.
// Dates rendues en AAAA-MM-JJ par la base : un DATE lu par pg devient un Date à minuit heure
// locale, que toISOString décalerait d'un jour.
const enIso = (bd, colonne, alias) => bd.raw(`to_char(${colonne}, 'YYYY-MM-DD') as "${alias}"`);

async function trouverParDossierId(bd, entiteId, dossierId) {
  return bd('dossiers')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where({ 'dossiers.id': dossierId, 'dossiers.entite_id': entiteId })
    .select(
      'candidats.id as candidatId',
      'candidats.nom',
      'candidats.nom_naissance as nomNaissance',
      enIso(bd, 'candidats.date_naissance', 'dateNaissance'),
      'candidats.piece_identite_type as pieceIdentiteType',
      'candidats.piece_identite_numero as pieceIdentiteNumero',
      enIso(bd, 'candidats.piece_identite_delivree_le', 'pieceIdentiteDelivreeLe'),
      enIso(bd, 'candidats.piece_identite_expire_le', 'pieceIdentiteExpireLe'),
      'candidats.iban as ibanChiffre',
      'candidats.iban_iv as ibanIv',
      'candidats.bic',
      'candidats.piece_identite_a_completer as pieceIdentiteACompleter',
      'candidats.rib_a_completer as ribACompleter',
    )
    .first();
}

function mettreAJourPieceIdentite(bd, candidatId, { type, numero, delivreeLe, expireLe }) {
  return bd('candidats').where({ id: candidatId }).update({
    piece_identite_type: type,
    piece_identite_numero: numero,
    piece_identite_delivree_le: delivreeLe,
    piece_identite_expire_le: expireLe,
    piece_identite_a_completer: false,
  });
}

function mettreAJourRib(bd, candidatId, { ibanChiffre, ibanIv, bic }) {
  return bd('candidats').where({ id: candidatId }).update({ iban: ibanChiffre, iban_iv: ibanIv, bic, rib_a_completer: false });
}

function reporterPieceIdentite(bd, candidatId) {
  return bd('candidats').where({ id: candidatId }).update({ piece_identite_a_completer: true });
}

function reporterRib(bd, candidatId) {
  return bd('candidats').where({ id: candidatId }).update({ rib_a_completer: true });
}

module.exports = { trouverParDossierId, mettreAJourPieceIdentite, mettreAJourRib, reporterPieceIdentite, reporterRib };
