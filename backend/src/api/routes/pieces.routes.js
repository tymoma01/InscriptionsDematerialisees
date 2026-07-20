const { Router } = require('express');
const multer = require('multer');
const { z } = require('zod');
const pieceJustificativeService = require('../../core/dossier/pieceJustificativeService');

// Monté sur '/api/dossiers/:dossierId/pieces' (voir app.js) — `mergeParams: true` indispensable
// pour que req.params.dossierId reste visible ici (portée normalement limitée au routeur parent).
const router = Router({ mergeParams: true });

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
  // TODO(auth) : une fois l'authentification par session en place (voir CLAUDE.md, section
  // Authentification et rôles — auth.middleware.js et core/auth/session.js sont encore des
  // fichiers vides à ce jour), cette valeur doit venir de req.session.utilisateur.id, jamais du
  // corps de la requête envoyé par le client (trivialement falsifiable telle quelle). Acceptée en
  // body uniquement en attendant cette brique, pour que la route reste utilisable dès maintenant.
  uploadedBy: idPositifSchema,
});

const statutVerificationBodySchema = z.object({
  // 'en_attente' n'est jamais une cible de PATCH : c'est l'état par défaut avant toute
  // vérification (voir migration 028), pas une décision qu'un recruteur/accueil choisit.
  statutVerification: z.enum(['valide', 'rejete']),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// POST /api/dossiers/:dossierId/pieces — upload d'une pièce justificative (multipart/form-data,
// champ fichier "piece") vers le connecteur de stockage de l'entité, puis enregistrement de la
// référence en base.
router.post('/', upload.single('piece'), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    if (!req.file) {
      return res.status(400).json({ erreur: 'Fichier manquant (champ "piece").' });
    }
    const { typePieceCode, uploadedBy } = uploadBodySchema.parse(req.body);

    const resultat = await pieceJustificativeService.uploaderPieceJustificative(req.entite, {
      dossierId,
      typePieceCode,
      nomFichier: req.file.originalname,
      contenu: req.file.buffer,
      uploadedBy,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/pieces — liste des pièces justificatives d'un dossier.
router.get('/', async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const pieces = await pieceJustificativeService.listerPiecesJustificatives(req.entite, dossierId);
    res.json(pieces);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/pieces/:pieceId — redirige (302) vers une URL de téléchargement
// temporaire et pré-authentifiée chez le prestataire de stockage ; jamais d'accès public direct
// et permanent au fichier. Fonctionne aussi bien comme cible de <a href> que de <img src>.
router.get('/:pieceId', async (req, res, next) => {
  try {
    const pieceId = idPositifSchema.parse(req.params.pieceId);
    const url = await pieceJustificativeService.obtenirUrlTemporairePieceJustificative(req.entite, pieceId);
    res.redirect(302, url);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PATCH /api/dossiers/:dossierId/pieces/:pieceId — met à jour le statut de vérification
// (valide/rejeté) ; la date de vérification est posée par le serveur, jamais par le client
// (même principe que les autres horodatages de preuve du projet, voir dossierService.js).
router.patch('/:pieceId', async (req, res, next) => {
  try {
    const pieceId = idPositifSchema.parse(req.params.pieceId);
    const { statutVerification } = statutVerificationBodySchema.parse(req.body);

    const piece = await pieceJustificativeService.mettreAJourStatutVerificationPieceJustificative(
      req.entite,
      pieceId,
      statutVerification,
    );

    res.json(piece);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
