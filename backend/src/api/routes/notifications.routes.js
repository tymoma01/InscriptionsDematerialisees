const { Router } = require('express');
const { z } = require('zod');
const notificationService = require('../../core/notifications/notificationService');
const { requireAuth } = require('../middlewares/auth.middleware');

// Monté sur '/api/notifications' (voir app.js) — requireAuth seul, aucun rôle spécifique : tout
// agent connecté ne voit que SES notifications (req.utilisateur.id, jamais un id transmis par le
// client, voir notificationRepository.marquerLue), même principe self-service que moi.routes.js.
const router = Router();

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

router.get('/', async (req, res, next) => {
  try {
    const notifications = await notificationService.listerPourUtilisateur(req.utilisateur.id);
    res.json(notifications);
  } catch (erreur) {
    next(erreur);
  }
});

router.get('/compteur', async (req, res, next) => {
  try {
    const total = await notificationService.compterNonLues(req.utilisateur.id);
    res.json({ total });
  } catch (erreur) {
    next(erreur);
  }
});

router.patch('/tout-lire', async (req, res, next) => {
  try {
    await notificationService.marquerToutesLues(req.utilisateur.id);
    res.status(204).end();
  } catch (erreur) {
    next(erreur);
  }
});

router.patch('/:id/lue', async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    await notificationService.marquerLue(req.utilisateur.id, id);
    res.status(204).end();
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    next(erreur);
  }
});

module.exports = router;
