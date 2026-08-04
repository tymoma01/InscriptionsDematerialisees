// Accès données pour `lieux` (migration 044) — uniquement des requêtes, aucune règle métier ici,
// même découpage que utilisateurRepository.js/motifRepository.js.

// Scopé par entiteId : un lieuId est un entier séquentiel, donc devinable — même faille IDOR déjà
// corrigée pour les dossiers/pièces/relances/comptes utilisateurs, même patron que
// utilisateurRepository.trouverUtilisateurParId.
function trouverLieuParId(bd, entiteId, lieuId) {
  return bd('lieux').where({ id: lieuId, entite_id: entiteId }).first();
}

// Lieux actifs de l'entité courante — sert à peupler le sélecteur de lieu lors de la
// planification d'un test (voir ModalePlanificationTest.jsx), même patron que
// utilisateurRepository.listerUtilisateursParRoles pour le sélecteur de formateur.
function listerLieuxActifs(bd, entiteId) {
  return bd('lieux').where({ entite_id: entiteId, actif: true }).orderBy('id', 'asc');
}

module.exports = { trouverLieuParId, listerLieuxActifs };
