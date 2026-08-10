const db = require('../../db/knex');
const lieuRepository = require('./lieuRepository');

// Sert le sélecteur de lieu de ModalePlanificationTest.jsx (voir lieux.routes.js) — même patron
// que utilisateurService.listerFormateursEtInspecteurs pour le sélecteur de formateur.
async function listerLieuxActifs(entite) {
  const bd = await db.obtenirKnex();
  return lieuRepository.listerLieuxActifs(bd, entite.id);
}

// `code` (migration 044) sert d'identifiant stable de repli/debug (voir seedLieux.js : 'accecit',
// 'hotel_du_cadran') — un lieu créé à la volée depuis la modale de planification n'en a pas, ce
// slug le dérive du libellé saisi (accents retirés, tout ce qui n'est pas alphanumérique réduit à
// un seul '_', bornes coupées) plutôt que de laisser l'agent en saisir un : ce n'est pas une
// information qu'un utilisateur d'Accueil a de raison de connaître ou de choisir.
function slugifier(texte) {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Nombre d'essais borné (pas de boucle infinie) — au-delà, la collision est traitée comme une
// anomalie plutôt que réessayée indéfiniment (voir obtenirCodeUnique ci-dessous).
const TENTATIVES_MAX_CODE_UNIQUE = 50;

// `code` n'a pas de contrainte UNIQUE en base (voir lieuRepository.trouverLieuParCode) — vérifié
// ici plutôt que de laisser deux lieux au libellé proche collisionner silencieusement sur le même
// code. Suffixe numérique (_2, _3, ...) en cas de collision, même principe que la désambiguïsation
// de fichiers dupliqués (voir azureOneDriveConnector.js).
async function obtenirCodeUnique(bd, entiteId, libelle) {
  const base = slugifier(libelle) || 'lieu';
  for (let tentative = 1; tentative <= TENTATIVES_MAX_CODE_UNIQUE; tentative += 1) {
    const code = tentative === 1 ? base : `${base}_${tentative}`;
    // eslint-disable-next-line no-await-in-loop -- tentatives séquentielles nécessaires : chaque
    // essai dépend du résultat (encore pris ?) du précédent, pas parallélisable.
    const existant = await lieuRepository.trouverLieuParCode(bd, entiteId, code);
    if (!existant) return code;
  }
  throw new Error(`Impossible de générer un code de lieu unique pour "${libelle}" après ${TENTATIVES_MAX_CODE_UNIQUE} tentatives.`);
}

// Création à la volée depuis la modale de planification de test (voir ModalePlanificationTest.jsx,
// lieuService.js front, lieux.routes.js) — `libelle` est le seul champ saisi par l'agent (la
// table `lieux`, migration 044, n'a pas de colonne adresse séparée : le libellé porte déjà
// l'adresse complète en texte libre, voir seedLieux.js — "Hôtel du Cadran - 14 rue de Valadon,
// 75007 Paris" — et c'est ce texte qui est réutilisé tel quel comme location de l'invitation .ics,
// voir generateurIcs.js).
async function creerLieu(entite, { libelle }) {
  const bd = await db.obtenirKnex();
  const code = await obtenirCodeUnique(bd, entite.id, libelle);
  const [lieu] = await lieuRepository.creerLieu(bd, entite.id, { code, libelle });
  return lieu;
}

module.exports = { listerLieuxActifs, creerLieu };
