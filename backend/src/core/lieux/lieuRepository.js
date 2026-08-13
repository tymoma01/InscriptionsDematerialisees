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

// Colonnes renvoyées par creerLieu/modifierLieu — `libelle` n'y figure plus (migration 047, champs
// structurés) : ni l'un ni l'autre ne l'écrit plus, elle resterait NULL sur toute ligne créée
// après la bascule, sans intérêt pour l'appelant.
const COLONNES_LIEU = ['id', 'code', 'adresse', 'metro_acces', 'instructions', 'actif'];

// Création à la volée depuis la modale de planification de test (voir ModalePlanificationTest.jsx,
// bouton "+" à côté du sélecteur de lieu) — `actif` non transmis, la colonne a déjà `true` en
// valeur par défaut (migration 044). `metroAcces`/`instructions` optionnels (migration 047) :
// reçus déjà normalisés en `null` par lieuService (jamais `undefined`) — knex/pg lève une erreur
// "Undefined binding(s)" sur un binding `undefined` dans un insert/update, contrairement à `null`
// qui s'écrit sans problème.
function creerLieu(bd, entiteId, { code, adresse, metroAcces, instructions }) {
  return bd('lieux')
    .insert({ entite_id: entiteId, code, adresse, metro_acces: metroAcces, instructions })
    .returning(COLONNES_LIEU);
}

// Modification à la volée depuis la même modale (bouton crayon) — `code` n'est jamais modifiable
// (voir lieuService.modifierLieu : c'est l'identifiant technique du lieu, jamais montré ni resaisi
// par l'agent, aucune raison de le regénérer sur une simple correction de texte). Scopé par
// entiteId comme trouverLieuParId : un lieuId d'une autre entité ne matche aucune ligne, la mise à
// jour est alors un no-op (tableau vide en retour, voir lieuService qui traduit ça en 404).
function modifierLieu(bd, entiteId, lieuId, { adresse, metroAcces, instructions }) {
  return bd('lieux')
    .where({ id: lieuId, entite_id: entiteId })
    .update({ adresse, metro_acces: metroAcces, instructions })
    .returning(COLONNES_LIEU);
}

// Suppression depuis la même modale (bouton poubelle) — appelée uniquement après que
// lieuService.supprimerLieu ait vérifié qu'aucun rendez-vous ne référence plus ce lieu (migrés au
// préalable dans la même transaction si besoin, voir rendezvousRepository.migrerRendezvousVersLieu)
// : la FK rendezvous.lieu_id (migration 045, sans ON DELETE CASCADE) romprait sinon l'intégrité
// référentielle. Scopée par entiteId comme le reste de ce module (IDOR).
function supprimerLieu(bd, entiteId, lieuId) {
  return bd('lieux').where({ id: lieuId, entite_id: entiteId }).del();
}

module.exports = { trouverLieuParId, listerLieuxActifs, trouverLieuParCode, creerLieu, modifierLieu, supprimerLieu };
