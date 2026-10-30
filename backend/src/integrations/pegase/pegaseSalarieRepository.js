// Accès base du module Pégase : suivi de l'envoi par demande DPAE (table pegase_salaries) et
// lectures nécessaires à la construction de la fiche salarié.

function trouverSuivi(bd, demandeId) {
  return bd('pegase_salaries').where({ demande_dpae_id: demandeId }).first();
}

// Une ligne par demande : chaque tentative remplace la précédente.
function enregistrerSuivi(bd, demandeId, { statut, base = null, pegasePersonnelId = null, message = null, avertissements = [], piecesEnvoyees = [], piecesEnErreur = [] }) {
  return bd('pegase_salaries')
    .insert({
      demande_dpae_id: demandeId,
      statut,
      base,
      pegase_personnel_id: pegasePersonnelId,
      message,
      avertissements: JSON.stringify(avertissements),
      pieces_envoyees: JSON.stringify(piecesEnvoyees),
      pieces_en_erreur: JSON.stringify(piecesEnErreur),
      date_tentative: bd.fn.now(),
    })
    .onConflict('demande_dpae_id')
    .merge();
}

// Dossier le plus récent du candidat : celui dont les pièces sont les plus à jour. `type_poste`
// (bureau / hotel, bloc 'disponibilites') désigne la base Pégase du salarié.
function trouverDernierDossierCandidat(bd, entiteId, candidatId) {
  return bd('dossiers')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn('bloc_disponibilites.bloc_code', '=', bd.raw('?', ['disponibilites']));
    })
    .where({ 'dossiers.entite_id': entiteId, 'dossiers.candidat_id': candidatId })
    .orderBy('dossiers.id', 'desc')
    .first('dossiers.id', bd.raw("bloc_disponibilites.donnees ->> 'typePoste' as type_poste"));
}

async function libellesTypesPieces(bd, entiteId) {
  const types = await bd('types_pieces').where({ entite_id: entiteId }).select('code', 'libelle');
  return new Map(types.map((type) => [type.code, type.libelle]));
}

module.exports = { trouverSuivi, enregistrerSuivi, trouverDernierDossierCandidat, libellesTypesPieces };
