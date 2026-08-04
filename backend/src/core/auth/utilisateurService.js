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

// Formateurs ET inspecteurs actifs de l'entité (CLAUDE.md, section Rôles : "Formateur ... reçoit
// les notifications de test" ; Inspecteur : équivalent bureau, voir rbac.js) — sert à peupler le
// sélecteur unique lors de la planification d'un test (le formulaire ne distingue pas les deux à
// la sélection, voir ModalePlanificationTest.jsx : c'est le poste du dossier qui indique à
// Accueil/Coordination lequel des deux assigner), accessible à Accueil/Coordination sans lui
// donner les droits admin de listerUtilisateurs. Renommé depuis listerFormateurs — l'endpoint
// GET /api/formateurs (formateurs.routes.js) garde son nom d'origine (pas de raison de le
// renommer, changement purement interne).
async function listerFormateursEtInspecteurs(entite) {
  const bd = await db.obtenirKnex();
  return utilisateurRepository.listerUtilisateursParRoles(bd, entite.id, [ROLES.FORMATEUR, ROLES.INSPECTEUR]);
}

async function creerUtilisateur(entite, { nom, prenom, email, telephone, motDePasse, roleCode }) {
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
    // '' (champ laissé vide au formulaire) doit valoir "pas de numéro", pas une chaîne vide en
    // base — même choix que mettreAJourUtilisateur ci-dessous.
    telephone: telephone || null,
    motDePasseHash,
  });
}

// utilisateurConnecteId : jamais pris dans le corps de la requête (voir routes) — sert
// uniquement à interdire à un admin de désactiver son propre compte, seul garde-fou en place
// contre un verrouillage accidentel (rien n'empêche par ailleurs un autre admin de le faire).
async function mettreAJourUtilisateur(
  entite,
  utilisateurId,
  { nom, prenom, telephone, roleCode, actif, motDePasse },
  utilisateurConnecteId,
) {
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
  // '' vaut suppression du numéro (champ nullable, voir migration 043) — pas de valeur vide
  // stockée en base, seulement null ou une vraie chaîne.
  if (telephone !== undefined) champs.telephone = telephone || null;
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
  listerFormateursEtInspecteurs,
  creerUtilisateur,
  mettreAJourUtilisateur,
};
