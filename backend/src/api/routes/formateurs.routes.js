const { Router } = require('express');
const utilisateurService = require('../../core/auth/utilisateurService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/formateurs' (voir app.js) — top-level, distinct de '/api/utilisateurs' (gestion
// des comptes, admin uniquement) : un agent Accueil/Coordination doit pouvoir lister les
// formateurs pour assigner un rendez-vous de test (CLAUDE.md, étape "Envoi en test") sans avoir
// les droits d'administration des comptes.
const router = Router();

// Rôle Recruteur retiré (audit 2026-08-27) — voir suppression du rôle en base.
const ROLES_LECTURE_FORMATEURS = [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_LECTURE_FORMATEURS));

// GET /api/formateurs — formateurs ET inspecteurs actifs de l'entité courante ({ id, nom, prenom,
// role_code } — role_code en plus de la restriction habituelle de serialiserUtilisateur dans
// utilisateurs.routes.js, nécessaire au front pour filtrer par groupe, voir
// ModalePlanificationTest.jsx). Nom de route conservé tel quel malgré le renommage interne côté
// service (voir utilisateurService.js) : pas de raison de le changer, aucun client n'a besoin de
// connaître cette distinction.
router.get('/', async (req, res, next) => {
  try {
    const formateurs = await utilisateurService.listerFormateursEtInspecteurs(req.entite);
    res.json(formateurs);
  } catch (erreur) {
    next(erreur);
  }
});

module.exports = router;
