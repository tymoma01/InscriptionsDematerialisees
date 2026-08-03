const { Router } = require('express');
const { z } = require('zod');
const statistiquesService = require('../../core/statistiques/statistiquesService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');
const { POSTES_BUREAU, POSTES_HOTEL } = require('../../core/dossier/postesConstantes');

// Monté sur '/api/statistiques' (voir app.js) — tableau de bord KPI back-office, réservé à
// Recruteur/Admin (décision validée, cf. audit KPI Dashboard : pilotage transverse, distinct de
// l'usage plus opérationnel d'Accueil/Coordination).
const router = Router();

router.use(requireAuth);
router.use(requireRole(ROLES.RECRUTEUR, ROLES.ADMIN));

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const kpiQuerySchema = z
  .object({
    dateDebut: z.string().regex(DATE_REGEX),
    dateFin: z.string().regex(DATE_REGEX),
    // 'entité' Hôtellerie/Tertiaire = typePoste, pas une ligne de la table `entites` (voir
    // Modularité, CLAUDE.md — audit KPI Dashboard).
    typePoste: z.enum(['bureau', 'hotel']).optional(),
    poste: z.enum([...POSTES_BUREAU, ...POSTES_HOTEL]).optional(),
  })
  .refine((donnees) => donnees.dateDebut <= donnees.dateFin, {
    message: 'dateDebut doit précéder ou être égal à dateFin.',
    path: ['dateDebut'],
  });

// GET /api/statistiques/kpi?dateDebut=AAAA-MM-JJ&dateFin=AAAA-MM-JJ&typePoste=bureau|hotel&poste=<code>
// Un seul endpoint composite plutôt que 7 routes séparées : même filtres (période, poste/
// typePoste) appliqués aux 7 statistiques d'un même écran (Indicateurs.jsx), calculées en
// parallèle côté service (voir statistiquesService.obtenirIndicateursKpi).
router.get('/kpi', async (req, res, next) => {
  try {
    const { dateDebut, dateFin, typePoste, poste } = kpiQuerySchema.parse(req.query);
    const indicateurs = await statistiquesService.obtenirIndicateursKpi(req.entite, {
      dateDebut,
      dateFin,
      typePoste,
      poste,
    });
    res.json(indicateurs);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

module.exports = router;
