const { Router } = require('express');
const { z } = require('zod');
const rendezvousService = require('../../core/rendezvous/rendezvousService');
const { ErreurFormateurInvalide, ErreurPlanificationOutlook } = rendezvousService;
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/rendezvous' (voir app.js) — top-level, distinct de '/api/dossiers/:dossierId/
// rendezvous' (rendezvous.routes.js, scopé à un dossier précis) : la lecture de disponibilité
// Outlook ci-dessous concerne un formateur/inspecteur, indépendamment de tout dossier (elle sert
// à peupler le calendrier hebdomadaire AVANT même que l'agent ait choisi une date pour CE dossier).
const router = Router();

// Mêmes rôles que ROLES_GESTION_RENDEZVOUS (rendezvous.routes.js) — seuls Accueil/Coordination/
// Admin ouvrent la modale de planification (ModalePlanificationTest.jsx), jamais Formateur/
// Inspecteur. Rôle Recruteur retiré (audit 2026-08-27) — voir suppression du rôle en base.
const ROLES_LECTURE_DISPONIBILITES = [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_LECTURE_DISPONIBILITES));

const disponibilitesQuerySchema = z.object({
  formateurId: z.coerce.number().int().positive(),
  debut: z.string().trim().datetime({ offset: true }),
  fin: z.string().trim().datetime({ offset: true }),
});

// GET /api/rendezvous/disponibilites?formateurId=...&debut=...&fin=... — créneaux réellement
// occupés (calendrier Outlook départemental, formation@/tertiaire2@ selon le rôle de formateurId)
// pour CETTE personne précise sur la plage debut/fin (ISO avec offset, dateFin exclusive côté
// appelant) — voir rendezvousService.obtenirDisponibilitesFormateur pour la résolution
// calendrier/email et le filtrage par organisateur/participant.
router.get('/disponibilites', async (req, res, next) => {
  try {
    const { formateurId, debut, fin } = disponibilitesQuerySchema.parse(req.query);
    const creneaux = await rendezvousService.obtenirDisponibilitesFormateur(req.entite, { formateurId, debut, fin });
    res.json(creneaux);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    if (erreur instanceof ErreurFormateurInvalide) {
      return res.status(400).json({ erreur: erreur.message });
    }
    if (erreur instanceof ErreurPlanificationOutlook) {
      return res.status(502).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

module.exports = router;
