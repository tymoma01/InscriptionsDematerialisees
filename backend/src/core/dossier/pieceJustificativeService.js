// Non déstructurés exprès (mêmes raisons que dans azureOneDriveConnector.js) : les tests
// mockent `db.obtenirKnex` et les fonctions de `pieceJustificativeRepository` via `t.mock.method`,
// ce qui exige que les appels passent par la propriété du module plutôt qu'une référence figée.
const db = require('../../db/knex');
const storageFactory = require('../../integrations/stockage/storageFactory');
const pieceJustificativeRepository = require('./pieceJustificativeRepository');

// Les codes de type de pièce (CNI, RIB, attestation-formation...) ne sont volontairement pas
// figés ici : ils viennent de la table `types_pieces`, configurable par entité (voir Modularité,
// CLAUDE.md) — une autre entité peut avoir un jeu de pièces différent sans toucher ce module.

// dossierId reste la clé de rangement chez le connecteur (StorageConnector.upload(dossierId, fichier)),
// cohérente avec pieces_justificatives.dossier_id — pas de réorganisation par candidat_id/année.
async function uploaderPieceJustificative(entite, { dossierId, typePieceCode, nomFichier, contenu, uploadedBy }) {
  if (!Buffer.isBuffer(contenu)) {
    throw new Error('uploaderPieceJustificative attend un contenu de type Buffer');
  }
  if (typeof nomFichier !== 'string' || !nomFichier.trim()) {
    throw new Error('uploaderPieceJustificative attend un nomFichier non vide');
  }

  const bd = await db.obtenirKnex();
  const typePiece = await pieceJustificativeRepository.trouverTypePieceParCode(bd, entite.id, typePieceCode);
  if (!typePiece) {
    throw new Error(`Type de pièce "${typePieceCode}" non configuré pour l'entité « ${entite.code} ».`);
  }

  // Upload distant avant écriture en base : en cas d'échec de l'insertion, mieux vaut un fichier
  // orphelin sur le stockage (négligeable) qu'une ligne pieces_justificatives pointant vers un
  // fichier qui n'a jamais été réellement envoyé (trompeur pour le second contrôle RH).
  const connecteur = storageFactory(entite.connecteur_stockage);
  const referenceStockage = await connecteur.upload(dossierId, { nom: nomFichier, contenu });

  const pieceId = await pieceJustificativeRepository.enregistrerPieceJustificative(bd, {
    dossierId,
    typePieceId: typePiece.id,
    referenceStockage,
    nomFichier,
    uploadedBy,
  });

  return { pieceId, referenceStockage };
}

async function telechargerPieceJustificative(entite, pieceId) {
  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, pieceId);
  if (!piece) {
    throw new Error(`Pièce justificative "${pieceId}" introuvable.`);
  }

  const connecteur = storageFactory(entite.connecteur_stockage);
  const contenu = await connecteur.download(piece.reference_stockage);

  return { nomFichier: piece.nom_fichier, contenu };
}

// Droit à l'effacement RGPD : supprime le fichier chez le prestataire de stockage avant de
// retirer la ligne en base, pour ne jamais garder une référence vers un fichier déjà effacé.
async function supprimerPieceJustificative(entite, pieceId) {
  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, pieceId);
  if (!piece) {
    throw new Error(`Pièce justificative "${pieceId}" introuvable.`);
  }

  const connecteur = storageFactory(entite.connecteur_stockage);
  await connecteur.supprimer(piece.reference_stockage);
  await pieceJustificativeRepository.supprimerPieceJustificativeParId(bd, pieceId);
}

function listerPiecesJustificatives(entite, dossierId) {
  return db.obtenirKnex().then((bd) => pieceJustificativeRepository.listerPiecesParDossier(bd, dossierId));
}

// URL de téléchargement temporaire et pré-authentifiée (ex. `@microsoft.graph.downloadUrl` côté
// OneDrive, valide ~1h) — jamais d'accès public direct et permanent au fichier chez le
// prestataire de stockage.
async function obtenirUrlTemporairePieceJustificative(entite, pieceId) {
  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, pieceId);
  if (!piece) {
    throw new Error(`Pièce justificative "${pieceId}" introuvable.`);
  }

  const connecteur = storageFactory(entite.connecteur_stockage);
  return connecteur.obtenirUrlTemporaire(piece.reference_stockage);
}

const STATUTS_VERIFICATION_AUTORISES = ['valide', 'rejete'];

// L'horodatage de vérification est celui du serveur au moment de l'appel, jamais une date
// envoyée par le client — même principe que les autres horodatages de preuve du projet
// (signature de charte, signature RGPD, voir CLAUDE.md).
async function mettreAJourStatutVerificationPieceJustificative(entite, pieceId, statutVerification) {
  if (!STATUTS_VERIFICATION_AUTORISES.includes(statutVerification)) {
    throw new Error(
      `Statut de vérification "${statutVerification}" invalide (attendu : ${STATUTS_VERIFICATION_AUTORISES.join(' ou ')}).`,
    );
  }

  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, pieceId);
  if (!piece) {
    throw new Error(`Pièce justificative "${pieceId}" introuvable.`);
  }

  return pieceJustificativeRepository.mettreAJourStatutVerification(bd, pieceId, {
    statutVerification,
    dateVerification: new Date(),
  });
}

module.exports = {
  uploaderPieceJustificative,
  telechargerPieceJustificative,
  supprimerPieceJustificative,
  listerPiecesJustificatives,
  obtenirUrlTemporairePieceJustificative,
  mettreAJourStatutVerificationPieceJustificative,
};
