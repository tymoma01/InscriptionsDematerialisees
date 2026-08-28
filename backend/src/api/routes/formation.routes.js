const { Router } = require('express');
const { z } = require('zod');
const dossierService = require('../../core/dossier/dossierService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers/:dossierId/formation' (voir app.js) — `mergeParams: true` indispensable
// pour que req.params.dossierId reste visible ici, même patron que relances.routes.js/notes.routes.js.
const router = Router({ mergeParams: true });

// Mêmes rôles que ROLES_LECTURE_RELANCES (relances.routes.js)/ROLES_LECTURE_INSCRIPTION
// (dossiers.routes.js) : quiconque peut déjà consulter cette fiche dossier peut consulter son
// historique de formation, en lecture seule — ces entrées sont produites automatiquement par les
// transitions de "Suivi des formations" (SuiviFormation.jsx), jamais saisies directement ici, donc
// aucune route d'écriture dans ce fichier.
const ROLES_LECTURE_FORMATION = [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN, ROLES.FORMATEUR, ROLES.INSPECTEUR];

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

// GET /api/dossiers/:dossierId/formation — historique de formation du dossier (onglet
// "Formation" de la fiche dossier, audit 2026-08-28) : chaque envoi en formation avec son issue
// éventuelle (Formation validée/Formation non validée), du plus récent au plus ancien.
router.get('/', requireRole(...ROLES_LECTURE_FORMATION), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const historique = await dossierService.listerHistoriqueFormation(req.entite, dossierId);
    res.json(historique);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

module.exports = router;
