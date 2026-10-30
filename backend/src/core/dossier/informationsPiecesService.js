const db = require('../../db/knex');
const informationsPiecesRepository = require('./informationsPiecesRepository');
const journalAudit = require('../audit/journalAudit');
// IBAN chiffré avec la même clé que le NIR : `chiffrer`/`dechiffrer` opèrent sur n'importe quelle
// chaîne, ils n'ont de « NIR » que le nom du secret Key Vault.
const { chiffrer, dechiffrer } = require('../securite/nirCipher');

// Transition qui valide la candidature en planifiant le premier test (workflow.config.json) : elle
// exige la pièce d'identité et le RIB confirmés par l'accueil, ou reportés (« Renseigner plus
// tard »). Pas la replanification (replanifier_test) : le dossier a déjà passé ce contrôle.
const CODE_ACTION_PLANIFIER_TEST = 'planifier_test';

// Statuts d'arrivée refusés tant que des informations sont explicitement reportées : le dossier
// devient « prêt à l'embauche », puis embauché.
const STATUTS_EXIGEANT_INFORMATIONS_CONFIRMEES = ['valide_pret_embauche', 'embauche'];

class ErreurInformationsPiecesNonConfirmees extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurInformationsPiecesNonConfirmees';
  }
}

class ErreurInformationsPiecesDejaConfirmees extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurInformationsPiecesDejaConfirmees';
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
    aCompleter: { pieceIdentite: ligne.pieceIdentiteACompleter, rib: ligne.ribACompleter },
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

// Une pièce reportée n'est jamais « confirmée » : confirmer remet l'indicateur à faux.
const pieceIdentiteConfirmee = (ligne) => Boolean(ligne.pieceIdentiteType) && !ligne.pieceIdentiteACompleter;
const ribConfirme = (ligne) => Boolean(ligne.ibanChiffre) && !ligne.ribACompleter;

/**
 * Reporte la confirmation de la pièce d'identité (« Renseigner plus tard »), tracé au journal d'audit
 * dans la même transaction (qui, quand, quelle pièce) ; false si le dossier
 * n'appartient pas à l'entité. Refusée si la pièce est déjà confirmée : le report ne défait pas
 * une confirmation, on la corrige en confirmant de nouveau.
 */
async function reporterPieceIdentite(entite, dossierId, { utilisateurId, adresseIp }) {
  const bd = await db.obtenirKnex();
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  if (!ligne) return false;
  if (pieceIdentiteConfirmee(ligne)) {
    throw new ErreurInformationsPiecesDejaConfirmees('Les informations de la pièce d’identité sont déjà confirmées.');
  }
  await bd.transaction(async (trx) => {
    await informationsPiecesRepository.reporterPieceIdentite(trx, ligne.candidatId);
    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      action: 'piece_identite_report',
      tableCible: 'dossiers',
      cibleId: dossierId,
      adresseIp,
    });
  });
  return true;
}

/** Idem pour le RIB. */
async function reporterRib(entite, dossierId, { utilisateurId, adresseIp }) {
  const bd = await db.obtenirKnex();
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  if (!ligne) return false;
  if (ribConfirme(ligne)) {
    throw new ErreurInformationsPiecesDejaConfirmees('Les coordonnées bancaires sont déjà confirmées.');
  }
  await bd.transaction(async (trx) => {
    await informationsPiecesRepository.reporterRib(trx, ligne.candidatId);
    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      action: 'rib_report',
      tableCible: 'dossiers',
      cibleId: dossierId,
      adresseIp,
    });
  });
  return true;
}

/**
 * Refuse la planification du premier test tant que l'accueil n'a pas confirmé ou reporté la pièce
 * d'identité et le RIB. Appelée dans la transaction de planification (planificationRendezvousService.js), comme
 * rendezvousService.verifierDelaiAvantReplanification : sans effet pour les autres transitions.
 */
async function verifierInformationsPiecesConfirmees(entite, dossierId, transitions, bdExistante = null) {
  if (!transitions.some((transition) => transition.codeAction === CODE_ACTION_PLANIFIER_TEST)) return;
  const bd = bdExistante ?? (await db.obtenirKnex());
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  // Dossier introuvable : refusé ensuite par creerRendezvous, avec son propre message.
  if (!ligne) return;
  const manquantes = [
    ...(ligne.pieceIdentiteType || ligne.pieceIdentiteACompleter ? [] : ['les informations de la pièce d’identité']),
    ...(ligne.ibanChiffre || ligne.ribACompleter ? [] : ['les coordonnées bancaires']),
  ];
  if (manquantes.length > 0) {
    throw new ErreurInformationsPiecesNonConfirmees(
      `Impossible de valider la candidature : confirmez d’abord ${manquantes.join(' et ')} (écran des pièces justificatives), ou choisissez « Renseigner plus tard ».`,
    );
  }
}

/**
 * Refuse de passer le dossier à « prêt à l'embauche » (ou « embauché ») tant que la pièce
 * d'identité ou le RIB est explicitement reporté (« Renseigner plus tard »). Un dossier sans
 * informations et sans report (antérieur à l'OCR) n'est pas bloqué. Appelée par le moteur de
 * workflow pour toute transition, avec le code du statut d'arrivée : sans effet pour les autres.
 */
async function verifierInformationsPiecesConfirmeesPourEmbauche(entite, dossierId, statutDestinationCode, bdExistante = null) {
  if (!STATUTS_EXIGEANT_INFORMATIONS_CONFIRMEES.includes(statutDestinationCode)) return;
  const bd = bdExistante ?? (await db.obtenirKnex());
  const ligne = await informationsPiecesRepository.trouverParDossierId(bd, entite.id, dossierId);
  // Dossier introuvable : déjà refusé par le moteur de workflow.
  if (!ligne) return;
  const acompleter = [
    ...(ligne.pieceIdentiteACompleter ? ['de la pièce d’identité'] : []),
    ...(ligne.ribACompleter ? ['du RIB'] : []),
  ];
  if (acompleter.length > 0) {
    throw new ErreurInformationsPiecesNonConfirmees(
      `Informations ${acompleter.join(' et ')} à compléter avant de valider l’embauche.`,
    );
  }
}

module.exports = {
  TYPES_PIECE_IDENTITE,
  ibanValide,
  obtenirInformations,
  enregistrerPieceIdentite,
  enregistrerRib,
  reporterPieceIdentite,
  reporterRib,
  verifierInformationsPiecesConfirmees,
  verifierInformationsPiecesConfirmeesPourEmbauche,
  ErreurInformationsPiecesNonConfirmees,
  ErreurInformationsPiecesDejaConfirmees,
};
