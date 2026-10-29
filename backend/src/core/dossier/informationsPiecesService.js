const db = require('../../db/knex');
const informationsPiecesRepository = require('./informationsPiecesRepository');
// IBAN chiffré avec la même clé que le NIR : `chiffrer`/`dechiffrer` opèrent sur n'importe quelle
// chaîne, ils n'ont de « NIR » que le nom du secret Key Vault.
const { chiffrer, dechiffrer } = require('../securite/nirCipher');

// Transition qui valide la candidature en planifiant le premier test (workflow.config.json) : elle
// exige la pièce d'identité et le RIB confirmés par l'accueil. Pas la replanification
// (replanifier_test) : le dossier a déjà passé ce contrôle.
const CODE_ACTION_PLANIFIER_TEST = 'planifier_test';

class ErreurInformationsPiecesNonConfirmees extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurInformationsPiecesNonConfirmees';
  }
}

// Pièces d'identité reconnues (même liste que frontend/src/core/referentiels/typesPieceIdentite.js).
const TYPES_PIECE_IDENTITE = ['carte_identite', 'passeport', 'titre_sejour', 'carte_resident', 'recepisse'];

// Même contrôle que le front (frontend/src/core/pieceJustificative/ocr/iban.js) : clé ISO 13616
// (modulo 97), sur l'IBAN compacté en majuscules.
function ibanValide(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const chiffres = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (lettre) => String(lettre.charCodeAt(0) - 55));
  return BigInt(chiffres) % 97n === 1n;
}

/**
 * Informations confirmées de la pièce d'identité et du RIB, avec l'identité saisie au formulaire
 * (le front compare la pièce lue au nom et à la date de naissance). IBAN déchiffré ici, côté
 * serveur uniquement. null si le dossier n'appartient pas à l'entité.
 */
async function obtenirInformations(entite, dossierId) {
  const bd = await db.obtenirKnex();
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  if (!ligne) return null;
  return {
    candidat: { nom: ligne.nom, nomNaissance: ligne.nomNaissance, dateNaissance: ligne.dateNaissance },
    pieceIdentite: ligne.pieceIdentiteType
      ? {
          type: ligne.pieceIdentiteType,
          numero: ligne.pieceIdentiteNumero,
          delivreeLe: ligne.pieceIdentiteDelivreeLe,
          expireLe: ligne.pieceIdentiteExpireLe,
        }
      : null,
    rib: ligne.ibanChiffre ? { iban: await dechiffrer(ligne.ibanChiffre, ligne.ibanIv), bic: ligne.bic } : null,
  };
}

/** Enregistre la pièce confirmée par l'accueil ; false si le dossier n'appartient pas à l'entité. */
async function enregistrerPieceIdentite(entite, dossierId, piece) {
  const bd = await db.obtenirKnex();
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  if (!ligne) return false;
  await informationsPiecesRepository.mettreAJourPieceIdentite(bd, ligne.candidatId, piece);
  return true;
}

/** Enregistre l'IBAN (chiffré) et le BIC confirmés par l'accueil ; false si le dossier n'appartient pas à l'entité. */
async function enregistrerRib(entite, dossierId, { iban, bic }) {
  const bd = await db.obtenirKnex();
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  if (!ligne) return false;
  const { nirChiffre, iv } = await chiffrer(iban);
  await informationsPiecesRepository.mettreAJourRib(bd, ligne.candidatId, { ibanChiffre: nirChiffre, ibanIv: iv, bic });
  return true;
}

/**
 * Refuse la planification du premier test tant que l'accueil n'a pas confirmé la pièce d'identité
 * et le RIB. Appelée dans la transaction de planification (planificationRendezvousService.js), comme
 * rendezvousService.verifierDelaiAvantReplanification : sans effet pour les autres transitions.
 */
async function verifierInformationsPiecesConfirmees(entite, dossierId, transitions, bdExistante = null) {
  if (!transitions.some((transition) => transition.codeAction === CODE_ACTION_PLANIFIER_TEST)) return;
  const bd = bdExistante ?? (await db.obtenirKnex());
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  // Dossier introuvable : refusé ensuite par creerRendezvous, avec son propre message.
  if (!ligne) return;
  const manquantes = [
    ...(ligne.pieceIdentiteType ? [] : ['les informations de la pièce d’identité']),
    ...(ligne.ibanChiffre ? [] : ['les coordonnées bancaires']),
  ];
  if (manquantes.length > 0) {
    throw new ErreurInformationsPiecesNonConfirmees(
      `Impossible de valider la candidature : confirmez d’abord ${manquantes.join(' et ')} (écran des pièces justificatives).`,
    );
  }
}

module.exports = {
  TYPES_PIECE_IDENTITE,
  ibanValide,
  obtenirInformations,
  enregistrerPieceIdentite,
  enregistrerRib,
  verifierInformationsPiecesConfirmees,
  ErreurInformationsPiecesNonConfirmees,
};
