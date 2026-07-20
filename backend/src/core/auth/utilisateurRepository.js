// Accès données pour les utilisateurs internes (auth) — uniquement des requêtes, aucune règle
// métier ici (orchestrée par authService.js), même découpage que dossierRepository.js.

// Scopé par entiteId : un utilisateur appartient à une seule entité (voir
// docs/schema-bdd-proposition.md), la résolution se fait donc toujours dans le contexte de
// l'entité résolue par entiteContext pour la requête en cours — jamais une recherche globale.
function trouverParEmail(bd, entiteId, email) {
  return bd('utilisateurs')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'utilisateurs.entite_id': entiteId, 'utilisateurs.email': email, 'utilisateurs.actif': true })
    .select(
      'utilisateurs.id',
      'utilisateurs.entite_id',
      'utilisateurs.nom',
      'utilisateurs.prenom',
      'utilisateurs.email',
      'utilisateurs.mot_de_passe_hash',
      'roles.code as role_code',
    )
    .first();
}

function mettreAJourDerniereConnexion(bd, utilisateurId, date) {
  return bd('utilisateurs').where({ id: utilisateurId }).update({ derniere_connexion: date });
}

module.exports = { trouverParEmail, mettreAJourDerniereConnexion };
