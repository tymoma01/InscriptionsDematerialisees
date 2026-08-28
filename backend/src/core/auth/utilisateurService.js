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

// Défense en profondeur (audit du rôle Recruteur, 2026-08-27) : `listerRolesAssignables` filtre
// déjà `assignable = true` pour le sélecteur du formulaire, mais rien n'empêchait jusqu'ici un
// appel direct à l'API (roleCode envoyé à la main, en contournant le front) de réussir à attribuer
// un rôle retiré de la circulation — vérifié ici, sur la ligne `role` déjà résolue par
// trouverRoleParCode, dans les deux seuls chemins d'écriture (création/modification).
function rejeterRoleNonAssignable(role) {
  if (!role.assignable) {
    throw new Error(`Le rôle "${role.code}" n'est plus attribuable.`);
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
  rejeterRoleNonAssignable(role);

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
    // Un compte qui porte DÉJÀ ce rôle (ex. un des 8 comptes Recruteur existants) reste modifiable
    // sur ses autres champs (actif, nom...) sans jamais repasser par ce rôle non assignable dans
    // le même appel — ce garde-fou ne bloque qu'un roleCode explicitement RESOUMIS dans la requête,
    // jamais une simple absence de changement de rôle.
    rejeterRoleNonAssignable(role);
    champs.role_id = role.id;
  }
  if (motDePasse) {
    champs.mot_de_passe_hash = await hacherMotDePasse(motDePasse);
  }

  return utilisateurRepository.mettreAJourUtilisateur(bd, utilisateurId, champs);
}

// Écran "Mon profil" (audit 2026-08-28, formateur/inspecteur connecté) — distinct de
// mettreAJourUtilisateur ci-dessus (écran admin, tous champs, sur N'IMPORTE QUEL compte de
// l'entité) : ici, seuls telephone et recevoirEmailPlanification sont modifiables, et
// utilisateurId vient TOUJOURS de req.utilisateur.id côté route (jamais des params/body), jamais
// un autre compte. Pas de vérification `cible` séparée (contrairement à mettreAJourUtilisateur) :
// req.utilisateur.id est déjà garanti appartenir à l'entité courante par requireAuth
// (auth.middleware.js, comparaison utilisateur.entiteId === req.entite.id).
async function mettreAJourMonProfil(utilisateurId, { telephone, recevoirEmailPlanification }) {
  const bd = await db.obtenirKnex();

  const champs = {};
  // '' vaut suppression du numéro, même convention que mettreAJourUtilisateur ci-dessus.
  if (telephone !== undefined) champs.telephone = telephone || null;
  if (recevoirEmailPlanification !== undefined) champs.recevoir_email_planification = recevoirEmailPlanification;

  return utilisateurRepository.mettreAJourUtilisateur(bd, utilisateurId, champs);
}

module.exports = {
  listerUtilisateurs,
  listerRolesAssignables,
  listerFormateursEtInspecteurs,
  creerUtilisateur,
  mettreAJourUtilisateur,
  mettreAJourMonProfil,
};
