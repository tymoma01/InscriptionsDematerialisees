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

// Écran admin de gestion des comptes (voir core/auth/utilisateurService.js) — le rôle système
// (voir rbac.js, ROLES.SYSTEME) n'est jamais un compte à gérer depuis cet écran : il n'apparaît
// jamais dans cette liste.
function listerUtilisateurs(bd, entiteId) {
  return bd('utilisateurs')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'utilisateurs.entite_id': entiteId })
    .andWhereNot('roles.code', 'systeme')
    .select(
      'utilisateurs.id',
      'utilisateurs.nom',
      'utilisateurs.prenom',
      'utilisateurs.email',
      'utilisateurs.actif',
      'utilisateurs.derniere_connexion',
      'utilisateurs.date_creation',
      'roles.code as role_code',
      'roles.libelle as role_libelle',
    )
    .orderBy('utilisateurs.nom', 'asc');
}

// Scopé par entiteId : un utilisateurId est un entier séquentiel, donc devinable — sans ce
// filtre, un admin d'une entité pourrait lire/modifier le compte d'une autre entité en devinant
// son id, même faille IDOR déjà corrigée pour les dossiers/pièces/relances. Jointure sur roles
// pour que utilisateurService puisse refuser d'éditer un compte système même si son id est
// deviné/forgé (l'exclusion de listerUtilisateurs ne suffit pas à elle seule, voir
// utilisateurService.mettreAJourUtilisateur).
function trouverUtilisateurParId(bd, entiteId, utilisateurId) {
  return bd('utilisateurs')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'utilisateurs.id': utilisateurId, 'utilisateurs.entite_id': entiteId })
    .select('utilisateurs.*', 'roles.code as role_code')
    .first();
}

// email est UNIQUE au niveau base mais PAS scopé par entité (migration 003) — un même email ne
// peut appartenir qu'à un seul compte, tous entités confondues ; la recherche d'unicité avant
// création doit donc rester globale, pas filtrée par entiteId.
function trouverUtilisateurParEmailGlobal(bd, email) {
  return bd('utilisateurs').where({ email }).first();
}

function trouverRoleParCode(bd, code) {
  return bd('roles').where({ code }).first();
}

// Rôles assignables depuis l'écran admin — systeme exclu : ce n'est pas un niveau de permission
// réel pour un humain, seulement un marqueur d'attribution pour les transitions automatiques
// (voir rbac.js).
function listerRolesAssignables(bd) {
  return bd('roles').whereNot('code', 'systeme').orderBy('id', 'asc');
}

// Utilisateurs actifs d'un rôle donné pour l'entité — sert par ex. à peupler le sélecteur de
// formateur lors de la planification d'un test (voir rendezvous.routes.js), sans passer par
// l'écran de gestion des comptes (admin uniquement, voir utilisateurs.routes.js) : un agent
// Accueil/Coordination doit pouvoir lister les formateurs sans avoir les droits d'administration.
function listerUtilisateursParRole(bd, entiteId, roleCode) {
  return bd('utilisateurs')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'utilisateurs.entite_id': entiteId, 'roles.code': roleCode, 'utilisateurs.actif': true })
    .select('utilisateurs.id', 'utilisateurs.nom', 'utilisateurs.prenom')
    .orderBy('utilisateurs.nom', 'asc');
}

async function creerUtilisateur(bd, { entiteId, roleId, nom, prenom, email, motDePasseHash }) {
  const [utilisateur] = await bd('utilisateurs')
    .insert({ entite_id: entiteId, role_id: roleId, nom, prenom, email, mot_de_passe_hash: motDePasseHash })
    .returning('*');
  return utilisateur;
}

async function mettreAJourUtilisateur(bd, utilisateurId, champs) {
  const [utilisateur] = await bd('utilisateurs').where({ id: utilisateurId }).update(champs).returning('*');
  return utilisateur;
}

module.exports = {
  trouverParEmail,
  mettreAJourDerniereConnexion,
  listerUtilisateurs,
  trouverUtilisateurParId,
  trouverUtilisateurParEmailGlobal,
  trouverRoleParCode,
  listerRolesAssignables,
  listerUtilisateursParRole,
  creerUtilisateur,
  mettreAJourUtilisateur,
};
