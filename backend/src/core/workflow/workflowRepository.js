// Accès données pour `transitions_statut` (migration 005) — uniquement des requêtes, aucune
// règle métier ici (orchestrée par workflowEngine.js), même découpage que dossierRepository.js.

// La transition permise depuis le statut courant d'un dossier pour une action donnée — c'est
// cette ligne (ou son absence) qui détermine si l'action est possible du tout, pas un
// switch/case en dur (voir Modularité, CLAUDE.md).
function trouverTransition(bd, entiteId, statutOrigineId, codeAction) {
  return bd('transitions_statut')
    .where({ entite_id: entiteId, statut_origine_id: statutOrigineId, code_action: codeAction })
    .first();
}

// Un rôle est autorisé sur une transition s'il existe une ligne `transition_roles` pour ce
// couple (migration 006) — table jusqu'ici non exploitée (voir workflowEngine.js pour la
// politique "fail closed" appliquée quand aucune ligne n'existe pour une transition donnée).
async function transitionAutoriseePourRole(bd, transitionId, roleCode) {
  const ligne = await bd('transition_roles')
    .join('roles', 'roles.id', 'transition_roles.role_id')
    .where({ 'transition_roles.transition_id': transitionId, 'roles.code': roleCode })
    .first();
  return Boolean(ligne);
}

// Transitions possibles depuis le statut courant d'un dossier POUR UN RÔLE DONNÉ (jointure sur
// transition_roles + roles) — avec le libellé du statut d'arrivée, sert au front à savoir quelles
// actions proposer sans coder de code_action en dur (voir Modularité, CLAUDE.md). Une transition
// sans ligne transition_roles n'apparaît pour aucun rôle (fail closed, cohérent avec
// transitionAutoriseePourRole).
function listerTransitionsAutoriseesDepuisStatut(bd, entiteId, statutOrigineId, roleCode) {
  return bd('transitions_statut')
    .join('statuts', 'statuts.id', 'transitions_statut.statut_destination_id')
    .join('transition_roles', 'transition_roles.transition_id', 'transitions_statut.id')
    .join('roles', 'roles.id', 'transition_roles.role_id')
    .where({
      'transitions_statut.entite_id': entiteId,
      'transitions_statut.statut_origine_id': statutOrigineId,
      'roles.code': roleCode,
    })
    .select(
      'transitions_statut.id',
      'transitions_statut.code_action',
      'transitions_statut.motif_requis',
      'statuts.code as statut_destination_code',
      'statuts.libelle as statut_destination_libelle',
    );
}

module.exports = { trouverTransition, transitionAutoriseePourRole, listerTransitionsAutoriseesDepuisStatut };
