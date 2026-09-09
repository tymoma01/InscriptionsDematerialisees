// Accès données pour la configuration du formulaire d'inscription — uniquement des requêtes,
// aucune règle métier ici (même découpage que dossierRepository.js/evaluationRepository.js).

// Tous les blocs connus pour une entité, actifs ou non (le filtre `actif` reste à la charge de
// l'appelant, voir useFormulaireInscription.js côté front) — jointure sur blocs_disponibles pour
// exposer le libellé, catalogue global des blocs que le moteur sait réellement afficher (voir
// scripts/seedBlocsDisponibles.js), distinct de leur activation/ordre propre à CETTE entité.
function listerBlocsFormulaire(bd, entiteId) {
  return bd('entite_blocs_formulaire')
    .join('blocs_disponibles', 'blocs_disponibles.code', 'entite_blocs_formulaire.bloc_code')
    .where({ 'entite_blocs_formulaire.entite_id': entiteId })
    .select(
      'entite_blocs_formulaire.bloc_code as code',
      'blocs_disponibles.libelle',
      'entite_blocs_formulaire.actif',
      'entite_blocs_formulaire.etape',
      'entite_blocs_formulaire.ordre',
      'entite_blocs_formulaire.largeur',
      'entite_blocs_formulaire.config',
    )
    .orderBy(['entite_blocs_formulaire.etape', 'entite_blocs_formulaire.ordre']);
}

module.exports = { listerBlocsFormulaire };
