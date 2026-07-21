const { Router } = require('express');
const dossierService = require('../../core/dossier/dossierService');
const relanceService = require('../../core/dossier/relanceService');
const rendezvousService = require('../../core/rendezvous/rendezvousService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers' (voir app.js) — distinct du routeur pièces justificatives, monté
// lui sur '/api/dossiers/:dossierId/pieces' (pieces.routes.js) : les deux coexistent sans
// collision, aucune route ici ne définit de segment dynamique qui capturerait '/pieces'.
const router = Router();

router.use(requireAuth);

// Vue centralisée des dossiers (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — mêmes rôles que la gestion des pièces justificatives (pieces.routes.js),
// c'est la suite du même parcours interne.
const ROLES_CONSULTATION_DOSSIERS = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

// GET /api/dossiers?statut=code — liste des dossiers de l'entité courante, filtrable par statut.
// Le code de statut n'est jamais figé ici : il vient de la table `statuts`, configurable par
// entité (voir Modularité, CLAUDE.md) — un code inconnu pour l'entité renvoie simplement une
// liste vide, pas une erreur.
router.get('/', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const dossiers = await dossierService.listerDossiers(req.entite, { statutCode: req.query.statut });
    res.json(dossiers);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/statuts — statuts configurés pour l'entité courante, dans l'ordre du
// workflow ; sert à construire les filtres du tableau de bord sans coder de code de statut en
// dur côté front (voir core/workflow/StatutBadge.jsx, pages/accueil/TableauDeBordAccueil.jsx).
router.get('/statuts', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const statuts = await dossierService.listerStatuts(req.entite);
    res.json(statuts);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/relances/motifs-resultat — résultats de relance configurés pour l'entité
// courante (table `motifs`, categorie 'resultat_relance'), pas propre à un dossier en
// particulier : sert à construire le formulaire d'ajout d'une relance sans coder de code en dur
// côté front (voir core/dossier/HistoriqueRelances.jsx). Vit ici plutôt que dans
// relances.routes.js (monté sur '/api/dossiers/:dossierId/relances') car cette liste ne dépend
// d'aucun dossierId — même logique que GET /api/dossiers/statuts ci-dessus.
router.get('/relances/motifs-resultat', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const motifs = await relanceService.listerMotifsResultatRelance(req.entite);
    res.json(motifs);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/rendezvous/motifs-desistement — motifs de désistement configurés pour
// l'entité courante (table `motifs`, categorie 'desistement'), pas propre à un dossier en
// particulier — même logique que GET /api/dossiers/relances/motifs-resultat ci-dessus.
router.get('/rendezvous/motifs-desistement', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const motifs = await rendezvousService.listerMotifsDesistement(req.entite);
    res.json(motifs);
  } catch (erreur) {
    next(erreur);
  }
});

module.exports = router;
