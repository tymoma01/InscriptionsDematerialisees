const db = require('../../db/knex');
const lieuRepository = require('./lieuRepository');

// Erreur métier distincte d'une Error générique (500 opaque) — même principe que
// ErreurStatistiquesInvalide (statistiquesService.js) : lieux.routes.js la traduit en 404 avec un
// message directement affichable à l'agent plutôt que de laisser un lieuId inexistant (ou d'une
// autre entité, voir modifierLieu ci-dessous) tomber dans le gestionnaire d'erreurs générique.
class ErreurLieuIntrouvable extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurLieuIntrouvable';
  }
}

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

// Modification à la volée depuis la même modale (bouton crayon à côté du sélecteur, voir
// ModalePlanificationTest.jsx) — seul `libelle` est modifiable, `code` reste inchangé (pas
// regénéré depuis le nouveau libellé : c'est un identifiant technique de repli/debug, pas une
// information qui a besoin de suivre une correction de texte, voir slugifier ci-dessus).
//
// Impact sur les rendez-vous déjà planifiés à ce lieu (point vérifié avant d'écrire cette
// fonction) : `rendezvous.lieu_id` est une FK vers `lieux` (migration 045), jamais une copie du
// libellé — invitationTestService.envoyerInvitationTest résout `lieu.libelle` à la volée à partir
// de cet id à CHAQUE appel, il n'existe nulle part de snapshot de l'adresse au moment de la
// planification. Concrètement : modifier un lieu ici change immédiatement l'adresse vue sur toute
// planification FUTURE utilisant ce lieu, et sur l'affichage back-office d'un rendez-vous existant
// s'il re-résout le lieu (même mécanisme). Mais envoyerInvitationTest n'est appelé qu'UNE SEULE
// fois, au moment de la création du rendez-vous (voir planificationRendezvousService.js) — une
// convocation SMS/email déjà envoyée à un candidat est un message déjà délivré, rien ne la
// régénère ni ne la renvoie automatiquement après coup. Donc : si l'adresse d'un lieu change après
// qu'une convocation a déjà été envoyée pour un rendez-vous à ce lieu, ce candidat garde l'ancienne
// adresse dans sa boîte mail/SMS tant que personne ne le relance manuellement — à signaler à
// l'agent Accueil comme point de vigilance opérationnel, pas quelque chose que ce correctif peut
// résoudre côté code (aucun mécanisme de renvoi automatique de convocation n'existe dans ce
// projet).
async function modifierLieu(entite, lieuId, { libelle }) {
  const bd = await db.obtenirKnex();
  const [lieu] = await lieuRepository.modifierLieu(bd, entite.id, lieuId, { libelle });
  if (!lieu) {
    throw new ErreurLieuIntrouvable(`Lieu "${lieuId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  return lieu;
}

module.exports = { listerLieuxActifs, creerLieu, modifierLieu, ErreurLieuIntrouvable };
