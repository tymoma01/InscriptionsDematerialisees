const { Router } = require('express');
const { z } = require('zod');
const informationsPiecesService = require('../../core/dossier/informationsPiecesService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requirePermission } = require('../middlewares/rbac.middleware');

const { TYPES_PIECE_IDENTITE, ibanValide } = informationsPiecesService;

// Monté sur '/api/dossiers/:dossierId/informations-pieces' (voir app.js). Informations de la pièce
// d'identité et du RIB lues par OCR sur la tablette, puis confirmées par l'accueil : le serveur ne
// fait jamais confiance à la lecture, il revalide ce que l'accueil a confirmé.
const router = Router({ mergeParams: true });

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.');
const compacter = (valeur) => valeur.replace(/\s+/g, '').toUpperCase();

const pieceIdentiteBodySchema = z
  .object({
    type: z.enum(TYPES_PIECE_IDENTITE),
    numero: z
      .string()
      .transform(compacter)
      .pipe(z.string().regex(/^[A-Z0-9]{5,30}$/, 'Numéro de 5 à 30 lettres et chiffres, tel qu’inscrit sur la pièce.')),
    // Absente de la bande MRZ : facultative, l'accueil la recopie si elle figure sur la pièce.
    delivreeLe: dateSchema.nullable().default(null),
    expireLe: dateSchema,
  })
  .refine(({ delivreeLe, expireLe }) => !delivreeLe || expireLe > delivreeLe, {
    path: ['expireLe'],
    message: 'La date d’expiration doit suivre la date de délivrance.',
  });

const ribBodySchema = z.object({
  iban: z.string().transform(compacter).refine(ibanValide, 'IBAN invalide (clé de contrôle incorrecte).'),
  bic: z
    .string()
    .transform(compacter)
    .pipe(z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/, 'BIC invalide (8 ou 11 caractères).')),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

const MESSAGE_DOSSIER_INTROUVABLE = 'Dossier introuvable.';

// GET /api/dossiers/:dossierId/informations-pieces — pièce et RIB confirmés (IBAN déchiffré).
router.get('/', requirePermission('lectureInformationsPieces'), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const informations = await informationsPiecesService.obtenirInformations(req.entite, dossierId);
    if (!informations) return res.status(404).json({ erreur: MESSAGE_DOSSIER_INTROUVABLE });
    res.json(informations);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PUT /api/dossiers/:dossierId/informations-pieces/piece-identite
router.put('/piece-identite', requirePermission('gestionPieces'), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const piece = pieceIdentiteBodySchema.parse(req.body);
    if (!(await informationsPiecesService.enregistrerPieceIdentite(req.entite, dossierId, piece))) {
      return res.status(404).json({ erreur: MESSAGE_DOSSIER_INTROUVABLE });
    }
    await journalAudit.enregistrerAction(await obtenirKnex(), {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'piece_identite_confirmation',
      tableCible: 'dossiers',
      cibleId: dossierId,
      donnees: { type: piece.type },
      adresseIp: req.ip,
    });
    res.json({ pieceIdentite: piece });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PUT /api/dossiers/:dossierId/informations-pieces/rib — l'IBAN n'est jamais écrit au journal.
router.put('/rib', requirePermission('gestionPieces'), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const rib = ribBodySchema.parse(req.body);
    if (!(await informationsPiecesService.enregistrerRib(req.entite, dossierId, rib))) {
      return res.status(404).json({ erreur: MESSAGE_DOSSIER_INTROUVABLE });
    }
    await journalAudit.enregistrerAction(await obtenirKnex(), {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'rib_confirmation',
      tableCible: 'dossiers',
      cibleId: dossierId,
      adresseIp: req.ip,
    });
    res.json({ rib });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PUT /api/dossiers/:dossierId/informations-pieces/piece-identite/plus-tard et /rib/plus-tard —
// « Renseigner plus tard » : aucun champ exigé, la pièce passe à « informations à compléter ».
function routeReport(chemin, reporter) {
  router.put(`${chemin}/plus-tard`, requirePermission('gestionPieces'), async (req, res, next) => {
    try {
      const dossierId = idPositifSchema.parse(req.params.dossierId);
      if (!(await reporter(req.entite, dossierId, { utilisateurId: req.utilisateur.id, adresseIp: req.ip }))) {
        return res.status(404).json({ erreur: MESSAGE_DOSSIER_INTROUVABLE });
      }
      res.json({ aCompleter: true });
    } catch (erreur) {
      if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
      if (erreur instanceof informationsPiecesService.ErreurInformationsPiecesDejaConfirmees) {
        return res.status(409).json({ erreur: erreur.message });
      }
      next(erreur);
    }
  });
}

routeReport('/piece-identite', informationsPiecesService.reporterPieceIdentite);
routeReport('/rib', informationsPiecesService.reporterRib);

module.exports = router;
module.exports.pieceIdentiteBodySchema = pieceIdentiteBodySchema;
module.exports.ribBodySchema = ribBodySchema;
