const { Router } = require('express');
const multer = require('multer');
const archiver = require('archiver');
const { z } = require('zod');
const pieceJustificativeService = require('../../core/dossier/pieceJustificativeService');
const { ErreurPieceJustificativeInvalide } = pieceJustificativeService;
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers/:dossierId/pieces' (voir app.js) — `mergeParams: true` indispensable
// pour que req.params.dossierId reste visible ici (portée normalement limitée au routeur parent).
const router = Router({ mergeParams: true });

// Toute la route pièces justificatives nécessite une session valide (voir auth.middleware.js) —
// CNI/carte vitale/RIB sont des données sensibles, jamais accessibles sans authentification
// (voir CLAUDE.auth-rbac.md pour le détail de ce qui était ouvert avant ce correctif).
router.use(requireAuth);

// Upload et vérification (valider/rejeter) restent du ressort de l'accueil/coordination et du
// recruteur (CLAUDE.md, section Parcours fonctionnel : "Prise de pièces justificatives par
// l'accueil" ; commentaire plus bas : "pas une décision qu'un recruteur/accueil choisit").
// L'admin est inclus par cohérence avec son rôle de gestion globale.
const ROLES_GESTION_PIECES = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];
// Consultation (liste, téléchargement) ouverte à tous les rôles internes.
const ROLES_CONSULTATION_PIECES = [...ROLES_GESTION_PIECES, ROLES.FORMATEUR];
// Export groupé (ZIP) réservé au Recruteur (CLAUDE.md, section Rôles, décision du 2026-07-31 —
// besoin RH "second contrôle" : télécharger/exporter les dossiers candidats). Volontairement plus
// restreint que ROLES_CONSULTATION_PIECES : télécharger le contenu réel de toutes les pièces d'un
// coup est un geste plus sensible que consulter une pièce à la fois.
const ROLES_EXPORT_ZIP_PIECES = [ROLES.RECRUTEUR];

// Fichier gardé en mémoire (pas écrit sur le disque du serveur applicatif) : part directement en
// Buffer vers le connecteur de stockage (StorageConnector.upload attend { nom, contenu: Buffer }).
// Limite alignée sur les pièces attendues (CNI/carte vitale/RIB/justificatifs scannés) : 15 Mio.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const idPositifSchema = z.coerce.number().int().positive();

const uploadBodySchema = z.object({
  // Les codes possibles (carte_identite, carte_vitale, rib, justificatif_domicile,
  // justificatif_experience, attestation_mutuelle...) ne sont volontairement pas figés en enum
  // ici : ils viennent de la table `types_pieces`, configurable par entité (voir Modularité,
  // CLAUDE.md — cf. scripts/seedTypesPieces.js pour amorcer ceux d'ACCECIT). Un code inconnu pour
  // l'entité courante est rejeté par pieceJustificativeService, pas ici.
  typePieceCode: z.string().trim().min(1),
  // uploadedBy n'est plus lu ici : il vient désormais de req.utilisateur.id (session serveur,
  // voir auth.middleware.js), jamais du corps de la requête envoyé par le client — un champ body
  // était trivialement falsifiable (voir CLAUDE.auth-rbac.md pour le détail de ce correctif).
});

const statutVerificationBodySchema = z.object({
  // 'en_attente' n'est jamais une cible de PATCH : c'est l'état par défaut avant toute
  // vérification (voir migration 028), pas une décision qu'un recruteur/accueil choisit.
  statutVerification: z.enum(['valide', 'rejete']),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// Types de pièces réellement produits par CaptureTablette.jsx (photo caméra toujours en .jpg, ou
// fichier choisi parmi image/*,application/pdf) — pas une table de configuration par entité :
// c'est la forme même de ce que le navigateur sait prévisualiser nativement, pas un vocabulaire
// métier. Extension inconnue -> application/octet-stream (le front retombe alors sur un
// téléchargement plutôt qu'un aperçu, sans faire échouer la requête).
const CONTENT_TYPE_PAR_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.pdf': 'application/pdf',
};

function deviserContentType(nomFichier) {
  const extension = nomFichier.slice(nomFichier.lastIndexOf('.')).toLowerCase();
  return CONTENT_TYPE_PAR_EXTENSION[extension] ?? 'application/octet-stream';
}

// POST /api/dossiers/:dossierId/pieces — upload d'une pièce justificative (multipart/form-data,
// champ fichier "piece") vers le connecteur de stockage de l'entité, puis enregistrement de la
// référence en base.
router.post('/', requireRole(...ROLES_GESTION_PIECES), upload.single('piece'), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    if (!req.file) {
      return res.status(400).json({ erreur: 'Fichier manquant (champ "piece").' });
    }
    const { typePieceCode } = uploadBodySchema.parse(req.body);

    const resultat = await pieceJustificativeService.uploaderPieceJustificative(req.entite, {
      dossierId,
      typePieceCode,
      nomFichier: req.file.originalname,
      contenu: req.file.buffer,
      uploadedBy: req.utilisateur.id,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'piece_justificative_upload',
      tableCible: 'pieces_justificatives',
      cibleId: resultat.pieceId,
      donnees: { dossierId, typePieceCode },
      adresseIp: req.ip,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/pieces — liste des pièces justificatives d'un dossier.
router.get('/', requireRole(...ROLES_CONSULTATION_PIECES), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const pieces = await pieceJustificativeService.listerPiecesJustificatives(req.entite, dossierId);
    res.json(pieces);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/pieces/export-zip — télécharge toutes les pièces justificatives
// d'un dossier en une seule archive (RH, "second contrôle", CLAUDE.md). Déclarée avant
// GET /:pieceId ci-dessous : Express matche les routes dans l'ordre de déclaration, et
// `:pieceId` matcherait la chaîne littérale "export-zip" comme n'importe quel autre segment si
// cette route venait après — l'ordre ici n'est donc pas juste cosmétique.
router.get('/export-zip', requireRole(...ROLES_EXPORT_ZIP_PIECES), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const fichiers = await pieceJustificativeService.listerPiecesJustificativesAvecContenu(req.entite, dossierId);
    if (fichiers.length === 0) {
      return res.status(404).json({ erreur: 'Aucune pièce justificative pour ce dossier.' });
    }

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="dossier-${dossierId}-pieces.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    // Une erreur de streaming survient après l'envoi des en-têtes (res.set ci-dessus) : on ne
    // peut plus renvoyer un JSON d'erreur propre à ce stade, juste couper la réponse — même
    // limite que n'importe quel flux HTTP déjà commencé.
    archive.on('error', (erreur) => {
      console.error(`Échec de génération du ZIP pour le dossier "${dossierId}" :`, erreur.message);
      res.destroy();
    });
    archive.pipe(res);

    for (const fichier of fichiers) {
      // Préfixé par le type de pièce (même convention que le chemin OneDrive à l'upload, voir
      // pieceJustificativeService.js) : garantit un nom d'entrée unique dans l'archive même si
      // deux pièces partageaient autrefois un nom de fichier d'origine identique.
      archive.append(fichier.contenu, { name: `${fichier.typePieceCode}_${fichier.nomFichier}` });
    }

    await archive.finalize();

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'pieces_justificatives_export_zip',
      tableCible: 'pieces_justificatives',
      // 0 = sentinel "aucune cible unique" (voir journalAudit.js, cible_id NOT NULL en base) :
      // cet export porte sur plusieurs pièces à la fois, pas une ligne pieces_justificatives
      // précise.
      cibleId: 0,
      donnees: { dossierId, nombrePieces: fichiers.length },
      adresseIp: req.ip,
    });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/pieces/:pieceId — redirige (302) vers une URL de téléchargement
// temporaire et pré-authentifiée chez le prestataire de stockage ; jamais d'accès public direct
// et permanent au fichier. Fonctionne aussi bien comme cible de <a href> que de <img src>.
router.get('/:pieceId', requireRole(...ROLES_CONSULTATION_PIECES), async (req, res, next) => {
  try {
    const pieceId = idPositifSchema.parse(req.params.pieceId);
    const url = await pieceJustificativeService.obtenirUrlTemporairePieceJustificative(req.entite, pieceId);
    res.redirect(302, url);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/pieces/:pieceId/apercu — sert le contenu réel de la pièce
// (bouton "Voir", CaptureTablette.jsx) pour un affichage direct côté client (image/PDF).
// Contrairement à la route ci-dessus, ne redirige pas vers l'URL de téléchargement temporaire
// Graph : le front la récupère en `blob` via l'instance `api` (axios), pas en navigation directe
// du navigateur — un fetch/XHR qui suivrait une redirection vers un domaine externe serait soumis
// au CORS, sans garantie que l'URL Graph l'autorise. Le fichier est donc rapatrié côté serveur
// (telechargerPieceJustificative, déjà écrite mais jusqu'ici jamais appelée) puis renvoyé depuis
// notre propre origine, avec un Content-Type déduit de l'extension et Content-Disposition: inline.
router.get('/:pieceId/apercu', requireRole(...ROLES_CONSULTATION_PIECES), async (req, res, next) => {
  try {
    const pieceId = idPositifSchema.parse(req.params.pieceId);
    const { nomFichier, contenu } = await pieceJustificativeService.telechargerPieceJustificative(req.entite, pieceId);
    res.set('Content-Type', deviserContentType(nomFichier));
    res.set('Content-Disposition', `inline; filename="${nomFichier.replace(/"/g, '')}"`);
    res.send(contenu);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

// PATCH /api/dossiers/:dossierId/pieces/:pieceId — met à jour le statut de vérification
// (valide/rejeté) ; la date de vérification est posée par le serveur, jamais par le client
// (même principe que les autres horodatages de preuve du projet, voir dossierService.js).
router.patch('/:pieceId', requireRole(...ROLES_GESTION_PIECES), async (req, res, next) => {
  try {
    const pieceId = idPositifSchema.parse(req.params.pieceId);
    const { statutVerification } = statutVerificationBodySchema.parse(req.body);

    const piece = await pieceJustificativeService.mettreAJourStatutVerificationPieceJustificative(
      req.entite,
      pieceId,
      statutVerification,
    );

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: `piece_justificative_${statutVerification}`,
      tableCible: 'pieces_justificatives',
      cibleId: pieceId,
      adresseIp: req.ip,
    });

    res.json(piece);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

// DELETE /api/dossiers/:dossierId/pieces/:pieceId — supprime une pièce justificative (fichier
// chez le prestataire de stockage + ligne en base), tant que le dossier est encore au statut
// en_attente_pieces (voir pieceJustificativeService.js, STATUTS_SUPPRESSION_AUTORISES) — une fois
// le test planifié, les pièces déjà prises pour cette étape ne sont plus modifiables.
router.delete('/:pieceId', requireRole(...ROLES_GESTION_PIECES), async (req, res, next) => {
  try {
    const pieceId = idPositifSchema.parse(req.params.pieceId);

    await pieceJustificativeService.supprimerPieceJustificative(req.entite, pieceId);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'piece_justificative_suppression',
      tableCible: 'pieces_justificatives',
      cibleId: pieceId,
      adresseIp: req.ip,
    });

    res.status(204).end();
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurPieceJustificativeInvalide) return res.status(400).json({ erreur: erreur.message });
    next(erreur);
  }
});

module.exports = router;
