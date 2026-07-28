const { Router } = require('express');
const { z } = require('zod');
const notesDossierService = require('../../core/dossier/notesDossierService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers/:dossierId/notes' (voir app.js) — `mergeParams: true` indispensable
// pour que req.params.dossierId reste visible ici, même patron que relances.routes.js.
const router = Router({ mergeParams: true });

// Journal de notes libres, indépendant des relances — ouvert à tous les rôles back-office ayant
// un accès direct à un dossier (mêmes rôles que ROLES_GESTION_TRANSITIONS, transitions.routes.js :
// le formateur agit sur un dossier au moment de l'évaluation, il doit pouvoir y laisser une note
// comme les autres). Pas de distinction lecture/écriture entre rôles : simple journal partagé.
const ROLES_NOTES_DOSSIER = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.FORMATEUR, ROLES.ADMIN];

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

const noteBodySchema = z.object({
  contenu: z.string().trim().min(1).max(1000),
  // auteurId n'est jamais lu ici : il vient de req.utilisateur.id (session serveur), jamais du
  // corps de la requête envoyé par le client — même principe que utilisateurId pour les relances.
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// POST /api/dossiers/:dossierId/notes — ajoute une note au journal du dossier.
router.post('/', requireRole(...ROLES_NOTES_DOSSIER), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const { contenu } = noteBodySchema.parse(req.body);

    const resultat = await notesDossierService.ajouterNote(req.entite, {
      dossierId,
      contenu,
      auteurId: req.utilisateur.id,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'note_dossier_creation',
      tableCible: 'notes_dossier',
      cibleId: resultat.noteId,
      donnees: { dossierId, contenu },
      adresseIp: req.ip,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/notes — journal du dossier, du plus récent au plus ancien.
router.get('/', requireRole(...ROLES_NOTES_DOSSIER), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const notes = await notesDossierService.listerNotes(req.entite, dossierId);
    res.json(notes);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
