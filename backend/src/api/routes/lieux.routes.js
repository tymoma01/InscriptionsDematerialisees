const { Router } = require('express');
const lieuService = require('../../core/lieux/lieuService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/lieux' (voir app.js) — top-level, même patron que formateurs.routes.js : un
// agent Accueil/Coordination ou Recruteur doit pouvoir lister les lieux pour planifier un
// rendez-vous de test (voir ModalePlanificationTest.jsx) sans avoir de droits d'administration.
const router = Router();

const ROLES_LECTURE_LIEUX = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_LECTURE_LIEUX));

// GET /api/lieux — lieux actifs de l'entité courante ({ id, code, libelle }).
router.get('/', async (req, res, next) => {
  try {
    const lieux = await lieuService.listerLieuxActifs(req.entite);
    res.json(lieux);
  } catch (erreur) {
    next(erreur);
  }
});

module.exports = router;
