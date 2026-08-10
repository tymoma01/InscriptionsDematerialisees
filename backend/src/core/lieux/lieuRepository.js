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

// Sert à vérifier qu'un code généré (voir lieuService.genererCodeUnique) n'entre pas en collision
// avec un lieu déjà existant de la même entité — y compris un lieu désactivé (pas de `actif:
// true` ici, contrairement à listerLieuxActifs) : la colonne `code` n'a pas de contrainte UNIQUE
// en base (migration 044), c'est cette vérification applicative qui en tient lieu.
function trouverLieuParCode(bd, entiteId, code) {
  return bd('lieux').where({ entite_id: entiteId, code }).first();
}

// Création à la volée depuis la modale de planification de test (voir ModalePlanificationTest.jsx,
// bouton "+" à côté du sélecteur de lieu) — `actif` non transmis, la colonne a déjà `true` en
// valeur par défaut (migration 044).
function creerLieu(bd, entiteId, { code, libelle }) {
  return bd('lieux').insert({ entite_id: entiteId, code, libelle }).returning(['id', 'code', 'libelle', 'actif']);
}

// Modification à la volée depuis la même modale (bouton crayon) — seul `libelle` est modifiable
// (voir lieuService.modifierLieu : `code` reste l'identifiant technique du lieu, jamais montré ni
// resaisi par l'agent, aucune raison de le regénérer sur une simple correction de texte). Scopé
// par entiteId comme trouverLieuParId : un lieuId d'une autre entité ne matche aucune ligne, la
// mise à jour est alors un no-op (tableau vide en retour, voir lieuService qui traduit ça en 404).
function modifierLieu(bd, entiteId, lieuId, { libelle }) {
  return bd('lieux').where({ id: lieuId, entite_id: entiteId }).update({ libelle }).returning(['id', 'code', 'libelle', 'actif']);
}

module.exports = { trouverLieuParId, listerLieuxActifs, trouverLieuParCode, creerLieu, modifierLieu };
