// Non déstructurés exprès (mêmes raisons que dans azureOneDriveConnector.js) : les tests
// mockent `db.obtenirKnex` et les fonctions de `pieceJustificativeRepository` via `t.mock.method`,
// ce qui exige que les appels passent par la propriété du module plutôt qu'une référence figée.
const db = require('../../db/knex');
const storageFactory = require('../../integrations/stockage/storageFactory');
const pieceJustificativeRepository = require('./pieceJustificativeRepository');
const dossierRepository = require('./dossierRepository');
const workflowEngine = require('../workflow/workflowEngine');
const { ROLES } = require('../auth/rbac');

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
// "Reprendre") reste possible : en_attente_pieces (le cas nominal, l'accueil prend les pièces),
// en_attente_verification (ajout tardif — ex. remplacer une pièce que le recruteur vient de
// rejeter — sans avoir à repasser explicitement le dossier en en_attente_pieces, transition qui
// n'existe d'ailleurs pas dans transitions_statut) et test_non_planifie (workflow v5, audit
// 2026-08-21 : la transition automatique 'pieces_completes' fait désormais quitter
// en_attente_pieces dès la dernière pièce obligatoire capturée, avant même que le test soit
// planifié — sans cet ajout, corriger une pièce ou en compléter une optionnelle entre ce moment-là
// et la planification effective du test exigerait à tort le rôle Admin).
const STATUTS_UPLOAD_AUTORISES = ['en_attente_pieces', 'en_attente_verification', 'test_non_planifie'];

// La capture d'une pièce ENCORE JAMAIS présente pour ce dossier reste tolérée quel que soit le
// statut atteint ensuite (test planifié, test réalisé, verdict rendu...) — ex. pièce optionnelle
// (justificatif d'expérience, attestation mutuelle) complétée tardivement pour le second contrôle
// RH (CLAUDE.md), y compris sur un dossier dont le test est déjà passé. Jamais le remplacement
// d'une pièce déjà présente en dehors de STATUTS_UPLOAD_AUTORISES : ce serait un moyen détourné de
// contourner l'interdiction de "Reprendre" une fois le dossier hors en_attente_pieces (même
// restriction que STATUTS_SUPPRESSION_AUTORISES côté suppression), donc revérifié explicitement
// plus bas (dejaPresente), pas seulement masqué côté front.
//
// 'nouveau' RETIRÉ de cette liste (audit 2026-08-21, workflow v5, "Inscrit" persistant) : la toute
// PREMIÈRE pièce d'un dossier encore à 'nouveau' est désormais précisément ce qui doit être
// autorisé — c'est cet upload qui déclenche automatiquement la transition 'premiere_piece_chargee'
// (nouveau -> en_attente_pieces, voir plus bas) ; avant ce changement, 'nouveau' n'était de toute
// façon jamais observable assez longtemps pour qu'un upload y soit tenté (voir dossierService.
// inscrireCandidat, qui basculait alors automatiquement en_attente_pieces dans la même transaction
// que la création du dossier).
//
// Exception : une pièce déjà présente mais 'orpheline' (migration 046 — fichier disparu du
// stockage documentaire, constaté par le système, pas un rejet humain remis en cause, voir
// scripts/marquerPiecesOrphelines.js) PEUT être remplacée même hors STATUTS_UPLOAD_AUTORISES. Ce
// n'est pas un contournement de la règle ci-dessus : il n'existe déjà plus rien à "Reprendre" côté
// stockage pour ce type de pièce sur ce dossier, la bloquer reviendrait à rendre la pièce
// irrécupérable pour de bon sur des dossiers pourtant déjà avancés (test réalisé, verdict rendu).
const STATUTS_AJOUT_PIECE_MANQUANTE_EXCLUS = [];

async function uploaderPieceJustificative(entite, { dossierId, typePieceCode, nomFichier, contenu, mimetype, uploadedBy, roleCode }) {
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

  // Garde défensive PARTIELLE, pas une preuve de capture réelle (migration 048,
  // types_pieces.capture_uniquement — ex. Photo d'identité) : capturerPhoto() de
  // CaptureTablette.jsx produit toujours un Blob 'image/jpeg' via canvas.toBlob, jamais autre
  // chose — un contenu qui n'est pas exactement ce type est donc forcément passé par un autre
  // chemin que ce bouton (fichier choisi, ou appel API direct avec ce content-type). CE QUE
  // CETTE VÉRIFICATION NE FAIT PAS : distinguer un vrai JPEG capturé à l'instant d'un JPEG
  // préexistant renommé/reconstruit puis envoyé via un appel API forgé avec le bon
  // Content-Type — aucune preuve de provenance (metadata EXIF, jeton signé côté client au
  // moment de la capture...) n'est demandée ni vérifiable ici. Techniquement, la restriction
  // "caméra uniquement" reste donc un contrôle d'UX côté front (bouton "Choisir un fichier"
  // absent pour ce type, voir CaptureTablette.jsx), pas une garantie de sécurité côté serveur
  // contre un appelant déterminé qui contournerait le navigateur.
  if (typePiece.capture_uniquement && mimetype !== 'image/jpeg') {
    throw new ErreurPieceJustificativeInvalide(
      `Le type de pièce "${typePieceCode}" doit être capturé directement depuis l'appareil photo (fichier attendu : image/jpeg).`,
    );
  }

  // Admin : accès total aux pièces d'un candidat "à tout moment, quel que soit le statut du
  // dossier" (CLAUDE.md, demande explicite du 2026-08-18) — contourne les deux gardes de statut
  // ci-dessous (mais pas la garde capture_uniquement plus haut, ni celle sur 'nouveau' : avant la
  // signature de la charte, il n'existe simplement encore aucun dossier "à débloquer", peu importe
  // le rôle). Les autres rôles (Accueil/Coordination, Recruteur) gardent leurs règles actuelles
  // inchangées.
  if (roleCode !== ROLES.ADMIN && !STATUTS_UPLOAD_AUTORISES.includes(dossier.statut_code)) {
    if (STATUTS_AJOUT_PIECE_MANQUANTE_EXCLUS.includes(dossier.statut_code)) {
      throw new ErreurPieceJustificativeInvalide(
        `Impossible d'ajouter une pièce justificative : le dossier "${dossierId}" est au statut "${dossier.statut_libelle}" ` +
          `(la charte doit être signée avant toute pièce justificative).`,
      );
    }
    const dejaPresente = await pieceJustificativeRepository.trouverPieceParDossierEtType(bd, dossierId, typePiece.id);
    if (dejaPresente && dejaPresente.statut_verification !== 'orpheline') {
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

  // Avancement automatique du statut dossier après upload (workflow v5, audit 2026-08-21) —
  // best-effort : la pièce est déjà correctement enregistrée ci-dessus à cet instant, un échec de
  // transition (config manquante pour cette entité, race...) ne doit jamais faire échouer l'upload
  // lui-même, voir faireAvancerStatutApresUpload plus bas pour le détail.
  await faireAvancerStatutApresUpload(entite, {
    dossierId,
    dossierStatutCodeAvantUpload: dossier.statut_code,
    uploadedBy,
    roleCode,
  });

  return { pieceId, referenceStockage };
}

// Deux transitions automatiques possibles à la suite d'un upload réussi (workflow v5, "Inscrit"
// persistant + "Test non planifié", audit 2026-08-21) — jamais bloquantes pour l'upload lui-même
// (try/catch dédié, même principe que les envois de notification best-effort ailleurs dans le
// projet, ex. invitationTestService.js) :
//
// 1. 'premiere_piece_chargee' (nouveau -> en_attente_pieces) : SEULEMENT si le dossier était
//    encore à 'nouveau' juste avant cet upload ET que c'est la toute première pièce jamais
//    capturée pour ce dossier (compterPiecesParDossier === 1 à cet instant précis) — un second
//    upload sur un dossier déjà en_attente_pieces ne doit évidemment rien redéclencher ici.
// 2. 'pieces_completes' (en_attente_pieces -> test_non_planifie) : dès que TOUS les types de
//    pièces obligatoires de l'entité sont désormais présents (voir
//    pieceJustificativeRepository.toutesPiecesObligatoiresPresentes) — vérifiée APRÈS la
//    transition 1 ci-dessus si elle a eu lieu (un dossier peut passer nouveau -> en_attente_pieces
//    -> test_non_planifie en un seul upload si l'entité ne configure qu'un seul type de pièce
//    obligatoire, cas limite mais correct).
//
// roleCode/uploadedBy réutilisés tels quels comme acteur de la transition (déjà l'agent réellement
// authentifié qui capture la pièce, voir pieces.routes.js) : jamais l'utilisateur système ici,
// contrairement à basculeTestNonRealiseService.js — ce n'est pas une tâche planifiée sans agent
// connecté, c'est un effet de bord immédiat de SON action.
//
// Silencieux (pas de transition déclenchée) si l'entité ne configure ni l'une ni l'autre de ces
// deux codeAction depuis le statut concerné (workflowEngine.appliquerTransition lève alors une
// erreur "non autorisée", capturée ci-dessous) : une entité qui n'a pas ce workflow (ou choisit de
// ne pas l'adopter) continue de fonctionner sans aucun changement de comportement.
async function faireAvancerStatutApresUpload(entite, { dossierId, dossierStatutCodeAvantUpload, uploadedBy, roleCode }) {
  const bd = await db.obtenirKnex();

  try {
    let statutCodeCourant = dossierStatutCodeAvantUpload;

    if (statutCodeCourant === 'nouveau') {
      const nombrePieces = await pieceJustificativeRepository.compterPiecesParDossier(bd, dossierId);
      if (nombrePieces === 1) {
        await workflowEngine.appliquerTransition(entite, {
          dossierId,
          codeAction: 'premiere_piece_chargee',
          commentaire: 'Première pièce justificative capturée — passage automatique en attente de pièces.',
          utilisateurId: uploadedBy,
          roleCode,
        });
        statutCodeCourant = 'en_attente_pieces';
      }
    }

    if (statutCodeCourant === 'en_attente_pieces') {
      const complet = await pieceJustificativeRepository.toutesPiecesObligatoiresPresentes(bd, entite.id, dossierId);
      if (complet) {
        await workflowEngine.appliquerTransition(entite, {
          dossierId,
          codeAction: 'pieces_completes',
          commentaire: 'Toutes les pièces justificatives obligatoires sont chargées — passage automatique en test non planifié.',
          utilisateurId: uploadedBy,
          roleCode,
        });
      }
    }
  } catch (erreur) {
    console.error(
      `Avancement automatique du statut après upload de pièce ignoré pour le dossier ${dossierId} :`,
      erreur.message,
    );
  }
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

// Téléchargement groupé (RH, "second contrôle" — CLAUDE.md : "besoin de télécharger/exporter les
// dossiers candidats") : le contenu réel de chaque pièce du dossier, une seule par type — la plus
// récente (voir listerPiecesAvecReferenceParDossier, triée date_upload desc), jamais deux
// fichiers pour un même type_piece_code dans l'export, même dédoublonnage que CaptureTablette.jsx
// (voir diagnostic pièces dupliquées) : sans lui, un export pourrait inclure une pièce orpheline
// désormais absente de OneDrive (voir le correctif du 2026-07-31 sur azureOneDriveConnector.supprimer).
// L'assemblage en ZIP est laissé à la route (pieces.routes.js) : c'est une préoccupation de
// réponse HTTP, pas une règle métier.
//
// Tolérance PAR PIÈCE (correctif du 2026-08-06) : `connecteur.download` peut échouer pour une
// pièce précise (référence OneDrive orpheline, ex. l'une des deux pièces d'un ancien doublon
// écrasé — voir le correctif du 2026-07-31 sur `supprimer` ; permissions Graph ; etc.) sans que
// les AUTRES pièces du dossier, elles parfaitement valides, aient une quelconque raison d'être
// bloquées. Avant ce correctif, `Promise.all` faisait tout échouer d'un coup sur la première
// pièce en erreur (diagnostic dossier #82, 2026-08-06) : chaque téléchargement est donc
// maintenant capturé individuellement plutôt que laissé se propager, et le résultat distingue les
// pièces récupérées des pièces manquantes (avec le message d'erreur traduit par
// `traduireErreurGraph`, déjà lisible) — à charge de l'appelant (pieces.routes.js) de générer
// quand même une archive avec ce qui est disponible, en listant clairement ce qui ne l'est pas.
async function listerPiecesJustificativesAvecContenu(entite, dossierId) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);

  const pieces = await pieceJustificativeRepository.listerPiecesAvecReferenceParDossier(bd, dossierId);
  const dernierePieceParType = new Map();
  for (const piece of pieces) {
    if (!dernierePieceParType.has(piece.type_piece_code)) {
      dernierePieceParType.set(piece.type_piece_code, piece);
    }
  }

  const connecteur = storageFactory(entite.connecteur_stockage);
  const resultats = await Promise.all(
    [...dernierePieceParType.values()].map(async (piece) => {
      try {
        return {
          disponible: true,
          typePieceCode: piece.type_piece_code,
          nomFichier: piece.nom_fichier,
          contenu: await connecteur.download(piece.reference_stockage),
        };
      } catch (erreur) {
        return {
          disponible: false,
          typePieceCode: piece.type_piece_code,
          nomFichier: piece.nom_fichier,
          erreur: erreur.message,
        };
      }
    }),
  );

  return {
    fichiers: resultats.filter((resultat) => resultat.disponible),
    manquantes: resultats
      .filter((resultat) => !resultat.disponible)
      .map(({ typePieceCode, nomFichier, erreur }) => ({ typePieceCode, nomFichier, erreur })),
  };
}

// Suppression permise tant que le test n'est pas encore planifié (planifier_test) : une fois
// celui-ci planifié, les pièces déjà prises pour cette étape ne doivent plus pouvoir être
// retirées — plus strict que STATUTS_UPLOAD_AUTORISES (qui admet aussi en_attente_verification, un
// ajout tardif après rejet du recruteur, cas où on remplace une pièce via un nouvel upload plutôt
// que d'en supprimer une existante). test_non_planifie ajouté (workflow v5, audit 2026-08-21) :
// même raison que sur STATUTS_UPLOAD_AUTORISES ci-dessus, la transition automatique
// 'pieces_completes' fait quitter en_attente_pieces avant que le test soit planifié.
const STATUTS_SUPPRESSION_AUTORISES = ['en_attente_pieces', 'test_non_planifie'];

// Droit à l'effacement RGPD : supprime le fichier chez le prestataire de stockage avant de
// retirer la ligne en base, pour ne jamais garder une référence vers un fichier déjà effacé.
// roleCode : Admin contourne STATUTS_SUPPRESSION_AUTORISES ci-dessous (CLAUDE.md, demande
// explicite du 2026-08-18 — "Voir, Reprendre et Supprimer n'importe quelle pièce d'un candidat, à
// tout moment, quel que soit le statut du dossier ou de la pièce"), les autres rôles gardent la
// règle actuelle.
async function supprimerPieceJustificative(entite, pieceId, roleCode) {
  const bd = await db.obtenirKnex();
  const piece = await pieceJustificativeRepository.trouverPieceJustificativeParId(bd, entite.id, pieceId);
  if (!piece) {
    throw new ErreurPieceJustificativeInvalide(`Pièce justificative "${pieceId}" introuvable.`);
  }

  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, piece.dossier_id);
  if (roleCode !== ROLES.ADMIN && !STATUTS_SUPPRESSION_AUTORISES.includes(dossier.statut_code)) {
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
  listerPiecesJustificativesAvecContenu,
  supprimerPieceJustificative,
  listerPiecesJustificatives,
  obtenirUrlTemporairePieceJustificative,
  mettreAJourStatutVerificationPieceJustificative,
  ErreurPieceJustificativeInvalide,
};
