const { Router } = require('express');
const multer = require('multer');
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
// Consultation (liste, téléchargement) ouverte à tous les rôles internes : le formateur doit
// pouvoir consulter/exporter un dossier (CLAUDE.md, section Rôles : "Formateur ... exporte les
// dossiers").
const ROLES_CONSULTATION_PIECES = [...ROLES_GESTION_PIECES, ROLES.FORMATEUR];

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
