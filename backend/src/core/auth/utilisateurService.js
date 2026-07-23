const db = require('../../db/knex');
const utilisateurRepository = require('./utilisateurRepository');
const { hacherMotDePasse } = require('./password');
const { ROLES } = require('./rbac');

// Gestion des comptes (écran admin, CLAUDE.md section Rôles : "Admin : gestion globale") —
// distinct d'authService.js, qui gère uniquement la connexion. Aucune suppression physique
// n'est exposée ici : un utilisateur est référencé par historique_statuts/relances/evaluations/
// journal_audit (FK NOT NULL pour la plupart), le supprimer casserait la traçabilité RGPD déjà
// en place ailleurs dans le projet — seule la désactivation (colonne `actif`, déjà utilisée par
// trouverParEmail pour bloquer la connexion) est proposée.

function rejeterRoleSysteme(roleCode) {
  if (roleCode === ROLES.SYSTEME) {
    throw new Error('Le rôle "systeme" ne peut pas être attribué depuis cet écran.');
  }
}

async function listerUtilisateurs(entite) {
  const bd = await db.obtenirKnex();
  return utilisateurRepository.listerUtilisateurs(bd, entite.id);
}

async function listerRolesAssignables() {
  const bd = await db.obtenirKnex();
  return utilisateurRepository.listerRolesAssignables(bd);
}

// Formateurs actifs de l'entité (CLAUDE.md, section Rôles : "Formateur ... reçoit les
// notifications de test") — sert à peupler le sélecteur lors de la planification d'un test,
// accessible à Accueil/Coordination sans lui donner les droits admin de listerUtilisateurs.
async function listerFormateurs(entite) {
  const bd = await db.obtenirKnex();
  return utilisateurRepository.listerUtilisateursParRole(bd, entite.id, ROLES.FORMATEUR);
}

async function creerUtilisateur(entite, { nom, prenom, email, motDePasse, roleCode }) {
  rejeterRoleSysteme(roleCode);

  const bd = await db.obtenirKnex();

  const role = await utilisateurRepository.trouverRoleParCode(bd, roleCode);
  if (!role) {
    throw new Error(`Rôle "${roleCode}" introuvable.`);
  }

  // Vérification préalable pour un message clair — la contrainte UNIQUE en base reste le
  // garde-fou réel en cas de double soumission concurrente (voir migration 003).
  const existant = await utilisateurRepository.trouverUtilisateurParEmailGlobal(bd, email);
  if (existant) {
    throw new Error(`Un compte existe déjà avec l'email "${email}".`);
  }

  const motDePasseHash = await hacherMotDePasse(motDePasse);
  return utilisateurRepository.creerUtilisateur(bd, {
    entiteId: entite.id,
    roleId: role.id,
    nom,
    prenom,
    email,
    motDePasseHash,
  });
}

// utilisateurConnecteId : jamais pris dans le corps de la requête (voir routes) — sert
// uniquement à interdire à un admin de désactiver son propre compte, seul garde-fou en place
// contre un verrouillage accidentel (rien n'empêche par ailleurs un autre admin de le faire).
async function mettreAJourUtilisateur(entite, utilisateurId, { nom, prenom, roleCode, actif, motDePasse }, utilisateurConnecteId) {
  if (roleCode !== undefined) {
    rejeterRoleSysteme(roleCode);
  }
  if (actif === false && utilisateurId === utilisateurConnecteId) {
    throw new Error('Vous ne pouvez pas désactiver votre propre compte.');
  }

  const bd = await db.obtenirKnex();

  const cible = await utilisateurRepository.trouverUtilisateurParId(bd, entite.id, utilisateurId);
  if (!cible) {
    throw new Error(`Utilisateur "${utilisateurId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  // Défense en profondeur : même si son id était deviné/forgé, un compte système ne se modifie
  // jamais depuis cet écran (il n'apparaît déjà pas dans listerUtilisateurs).
  if (cible.role_code === ROLES.SYSTEME) {
    throw new Error('Ce compte ne peut pas être géré depuis cet écran.');
  }

  const champs = {};
  if (nom !== undefined) champs.nom = nom;
  if (prenom !== undefined) champs.prenom = prenom;
  if (actif !== undefined) champs.actif = actif;
  if (roleCode !== undefined) {
    const role = await utilisateurRepository.trouverRoleParCode(bd, roleCode);
    if (!role) {
      throw new Error(`Rôle "${roleCode}" introuvable.`);
    }
    champs.role_id = role.id;
  }
  if (motDePasse) {
    champs.mot_de_passe_hash = await hacherMotDePasse(motDePasse);
  }

  return utilisateurRepository.mettreAJourUtilisateur(bd, utilisateurId, champs);
}

module.exports = {
  listerUtilisateurs,
  listerRolesAssignables,
  listerFormateurs,
  creerUtilisateur,
  mettreAJourUtilisateur,
};
