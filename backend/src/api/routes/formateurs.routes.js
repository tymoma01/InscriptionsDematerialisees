const { Router } = require('express');
const utilisateurService = require('../../core/auth/utilisateurService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/formateurs' (voir app.js) — top-level, distinct de '/api/utilisateurs' (gestion
// des comptes, admin uniquement) : un agent Accueil/Coordination ou Recruteur doit pouvoir lister
// les formateurs pour assigner un rendez-vous de test (CLAUDE.md, étape "Envoi en test") sans
// avoir les droits d'administration des comptes.
const router = Router();

const ROLES_LECTURE_FORMATEURS = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_LECTURE_FORMATEURS));

// GET /api/formateurs — formateurs actifs de l'entité courante ({ id, nom, prenom } uniquement,
// même restriction que serialiserUtilisateur dans utilisateurs.routes.js).
router.get('/', async (req, res, next) => {
  try {
    const formateurs = await utilisateurService.listerFormateurs(req.entite);
    res.json(formateurs);
  } catch (erreur) {
    next(erreur);
  }
});

module.exports = router;
