// Non déstructurés exprès (mêmes raisons que dans azureOneDriveConnector.js) : les tests
// mockent `db.obtenirKnex` et les fonctions de `pieceJustificativeRepository` via `t.mock.method`,
// ce qui exige que les appels passent par la propriété du module plutôt qu'une référence figée.
const db = require('../../db/knex');
const storageFactory = require('../../integrations/stockage/storageFactory');
const pieceJustificativeRepository = require('./pieceJustificativeRepository');
const dossierRepository = require('./dossierRepository');

// Erreur métier distincte d'une Error générique (500 opaque) : pieces.routes.js la traduit en 400
// avec un message directement affichable à l'agent — même principe que ErreurCreneauPris dans
// rendezvousService.js. Avant ce correctif, tous les rejets métier de ce module (statut non
// autorisé, pièce introuvable, remplacement interdit...) tombaient dans le gestionnaire d'erreurs
// générique de app.js ("Une erreur est survenue. Merci de réessayer."), sans jamais montrer la
// vraie cause à l'agent — y compris pour un rejet parfaitement normal et attendu.
class ErreurPieceJustificativeInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurPieceJustificativeInvalide';
  }
}

// dossierId vient toujours de l'URL (voir pieces.routes.js) : jamais traité sans confirmer au
// préalable qu'il appartient à l'entité résolue par entiteContext pour la requête en cours —
// sinon un utilisateur authentifié d'une entité pourrait agir sur le dossier d'une autre entité
// en devinant un dossierId (même faille IDOR que sur pieceId, voir pieceJustificativeRepository.js).
async function verifierDossierAppartientEntite(bd, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new ErreurPieceJustificativeInvalide(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
}

// Les codes de type de pièce (CNI, RIB, attestation-formation...) ne sont volontairement pas
// figés ici : ils viennent de la table `types_pieces`, configurable par entité (voir Modularité,
// CLAUDE.md) — une autre entité peut avoir un jeu de pièces différent sans toucher ce module.

// Statuts sous lesquels un upload de n'importe quelle pièce (nouvelle ou remplacement via
// "Reprendre") reste possible : en_attente_pieces (le cas nominal, l'accueil prend les pièces) et
// en_attente_verification (ajout tardif — ex. remplacer une pièce que le recruteur vient de
// rejeter — sans avoir à repasser explicitement le dossier en en_attente_pieces, transition qui
// n'existe d'ailleurs pas dans transitions_statut).
const STATUTS_UPLOAD_AUTORISES = ['en_attente_pieces', 'en_attente_verification'];

// La capture d'une pièce ENCORE JAMAIS présente pour ce dossier reste tolérée quel que soit le
// statut atteint ensuite (test planifié, test réalisé, verdict rendu...) — ex. pièce optionnelle
// (justificatif d'expérience, attestation mutuelle) complétée tardivement pour le second contrôle
// RH (CLAUDE.md), y compris sur un dossier dont le test est déjà passé. Seul 'nouveau' reste
// exclu : avant la signature de la charte, aucune pièce n'a de raison d'être capturée. Jamais le
// remplacement d'une pièce déjà présente en dehors de STATUTS_UPLOAD_AUTORISES : ce serait un
// moyen détourné de contourner l'interdiction de "Reprendre" une fois le dossier hors
// en_attente_pieces (même restriction que STATUTS_SUPPRESSION_AUTORISES côté suppression), donc
// revérifié explicitement plus bas (dejaPresente), pas seulement masqué côté front.
const STATUTS_AJOUT_PIECE_MANQUANTE_EXCLUS = ['nouveau'];

async function uploaderPieceJustificative(entite, { dossierId, typePieceCode, nomFichier, contenu, uploadedBy }) {
  if (!Buffer.isBuffer(contenu)) {
    throw new Error('uploaderPieceJustificative attend un contenu de type Buffer');
  }
  if (typeof nomFichier !== 'string' || !nomFichier.trim()) {
    throw new Error('uploaderPieceJustificative attend un nomFichier non vide');
  }

  const bd = await db.obtenirKnex();
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new ErreurPieceJustificativeInvalide(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }

  const typePiece = await pieceJustificativeRepository.trouverTypePieceParCode(bd, entite.id, typePieceCode);
  if (!typePiece) {
    throw new ErreurPieceJustificativeInvalide(`Type de pièce "${typePieceCode}" non configuré pour l'entité « ${entite.code} ».`);
  }

  if (!STATUTS_UPLOAD_AUTORISES.includes(dossier.statut_code)) {
    if (STATUTS_AJOUT_PIECE_MANQUANTE_EXCLUS.includes(dossier.statut_code)) {
      throw new ErreurPieceJustificativeInvalide(
        `Impossible d'ajouter une pièce justificative : le dossier "${dossierId}" est au statut "${dossier.statut_libelle}" ` +
          `(la charte doit être signée avant toute pièce justificative).`,
      );
    }
    const dejaPresente = await pieceJustificativeRepository.trouverPieceParDossierEtType(bd, dossierId, typePiece.id);
    if (dejaPresente) {
      throw new ErreurPieceJustificativeInvalide(
        `Impossible de remplacer une pièce justificative déjà capturée pour le dossier "${dossierId}" : le dossier n'est ` +
          `plus au statut "en attente de pièces".`,
      );
    }
  }

  // Upload distant avant écriture en base : en cas d'échec de l'insertion, mieux vaut un fichier
  // orphelin sur le stockage (négligeable) qu'une ligne pieces_justificatives pointant vers un
  // fichier qui n'a jamais été réellement envoyé (trompeur pour le second contrôle RH).
  //
  // dossierInfo transmet de quoi construire l'arborescence {année}/{mois}/{NOM_PRENOM} exigée
  // par le connecteur ACCECIT (Azure OneDrive) — dateCreation vient de dossiers.date_creation,
  // jamais recalculée si le dossier reste ouvert à cheval sur deux mois, cf.
  // dossierRepository.trouverDossierAvecStatutParId. Le connecteur reste seul responsable de la
  // construction du chemin final (normalisation incluse) : ce service ne connaît pas les
  // contraintes de nommage propres à SharePoint/OVH.
  const connecteur = storageFactory(entite.connecteur_stockage);
  const dossierInfo = {
    id: dossierId,
    dateCreation: dossier.date_creation,
    nomCandidat: dossier.candidat_nom,
    prenomCandidat: dossier.candidat_prenom,
  };
  // typePieceCode préfixé au nom transmis au connecteur (pas nomFichier seul, tel quel côté DB
  // — voir enregistrerPieceJustificative plus bas, qui garde le nom d'origine pour l'affichage/le
  // Content-Type de /apercu) : deux pièces de types différents peuvent être capturées depuis le
  // même fichier source (même nom d'origine, ex. "images.jpeg" pris deux fois) — sans ce préfixe,
  // elles atterrissent au même chemin OneDrive et se substituent l'une à l'autre côté stockage,
  // laissant une pièce avec une référence qui pointe en réalité sur le fichier de l'autre (bug
  // constaté en pratique, dossier 83, 2026-07-31 — voir aussi le correctif de tolérance sur les
  // suppressions 404 dans azureOneDriveConnector.js, qui absorbe les cas déjà en base).
  const referenceStockage = await connecteur.upload(dossierInfo, { nom: `${typePieceCode}_${nomFichier}`, contenu });

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
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, entite.id, pieceId);
  if (!piece) {
    throw new ErreurPieceJustificativeInvalide(`Pièce justificative "${pieceId}" introuvable.`);
  }

  const connecteur = storageFactory(entite.connecteur_stockage);
  const contenu = await connecteur.download(piece.reference_stockage);

  return { nomFichier: piece.nom_fichier, contenu };
}

// Suppression permise uniquement tant que le dossier est encore en_attente_pieces : une fois le
// test planifié (planifier_test), les pièces déjà prises pour cette étape ne doivent plus pouvoir
// être retirées — plus strict que STATUTS_UPLOAD_AUTORISES (qui admet aussi
// en_attente_verification, un ajout tardif après rejet du recruteur, cas où on remplace une pièce
// via un nouvel upload plutôt que d'en supprimer une existante).
const STATUTS_SUPPRESSION_AUTORISES = ['en_attente_pieces'];

// Droit à l'effacement RGPD : supprime le fichier chez le prestataire de stockage avant de
// retirer la ligne en base, pour ne jamais garder une référence vers un fichier déjà effacé.
async function supprimerPieceJustificative(entite, pieceId) {
  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, entite.id, pieceId);
  if (!piece) {
    throw new ErreurPieceJustificativeInvalide(`Pièce justificative "${pieceId}" introuvable.`);
  }

  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, piece.dossier_id);
  if (!STATUTS_SUPPRESSION_AUTORISES.includes(dossier.statut_code)) {
    throw new ErreurPieceJustificativeInvalide(
      `Impossible de supprimer cette pièce justificative : le dossier est au statut "${dossier.statut_libelle}" ` +
        `(attendu : en attente de pièces).`,
    );
  }

  const connecteur = storageFactory(entite.connecteur_stockage);
  await connecteur.supprimer(piece.reference_stockage);
  await pieceJustificativeRepository.supprimerPieceJustificativeParId(bd, pieceId);
}

async function listerPiecesJustificatives(entite, dossierId) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);
  return pieceJustificativeRepository.listerPiecesParDossier(bd, dossierId);
}

// URL de téléchargement temporaire et pré-authentifiée (ex. `@microsoft.graph.downloadUrl` côté
// OneDrive, valide ~1h) — jamais d'accès public direct et permanent au fichier chez le
// prestataire de stockage.
async function obtenirUrlTemporairePieceJustificative(entite, pieceId) {
  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, entite.id, pieceId);
  if (!piece) {
    throw new ErreurPieceJustificativeInvalide(`Pièce justificative "${pieceId}" introuvable.`);
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
    throw new ErreurPieceJustificativeInvalide(
      `Statut de vérification "${statutVerification}" invalide (attendu : ${STATUTS_VERIFICATION_AUTORISES.join(' ou ')}).`,
    );
  }

  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, entite.id, pieceId);
  if (!piece) {
    throw new ErreurPieceJustificativeInvalide(`Pièce justificative "${pieceId}" introuvable.`);
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
  ErreurPieceJustificativeInvalide,
};
