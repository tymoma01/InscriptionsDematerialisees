const { Router } = require('express');
const { z } = require('zod');
const dossierService = require('../../core/dossier/dossierService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requirePermission } = require('../middlewares/rbac.middleware');

// Monté sur '/api/dossiers/:dossierId/formation' (voir app.js) — `mergeParams: true` indispensable
// pour que req.params.dossierId reste visible ici, même patron que relances.routes.js/notes.routes.js.
const router = Router({ mergeParams: true });

// Mêmes rôles que lectureRelances (relances.routes.js)/lectureInscription
// (dossiers.routes.js) : quiconque peut déjà consulter cette fiche dossier peut consulter son
// historique de formation, en lecture seule — ces entrées sont produites automatiquement par les
// transitions de "Suivi des formations" (SuiviFormation.jsx), jamais saisies directement ici, donc
// aucune route d'écriture dans ce fichier.
// Inspecteur Hôtellerie ajouté le 2026-10-01 (onglet Formation en lecture, dans son périmètre).

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

// GET /api/dossiers/:dossierId/formation — historique de formation du dossier (onglet
// "Formation" de la fiche dossier, audit 2026-08-28) : chaque envoi en formation avec son issue
// éventuelle (Formation validée/Formation non validée), du plus récent au plus ancien.
router.get('/', requirePermission('lectureFormation'), async (req, res, next) => {
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
// Attachée sur l'objet router (même patron que transitions.routes.js/dossiers.routes.js) —
// permet au test (formation.routes.test.js) de vérifier que l'Inspecteur GARDE bien cet accès
// (audit 2026-09-26, retrait de son accès à "Suivi des formations" — cette route-ci, l'historique
// en lecture seule de la fiche dossier, n'est PAS concernée par ce retrait).
