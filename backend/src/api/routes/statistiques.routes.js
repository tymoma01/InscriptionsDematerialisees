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

// Champs communs aux deux routes ci-dessous (agrégats et liste de dossiers) — extrait pour éviter
// de dupliquer la validation période/poste/typePoste entre les deux, seul le `.refine` et le champ
// `indicateurs` diffèrent.
const champsCommunsSchema = z.object({
  dateDebut: z.string().regex(DATE_REGEX),
  dateFin: z.string().regex(DATE_REGEX),
  // 'entité' Hôtellerie/Tertiaire = typePoste, pas une ligne de la table `entites` (voir
  // Modularité, CLAUDE.md — audit KPI Dashboard).
  typePoste: z.enum(['bureau', 'hotel']).optional(),
  poste: z.enum([...POSTES_BUREAU, ...POSTES_HOTEL]).optional(),
});

const kpiQuerySchema = champsCommunsSchema.refine((donnees) => donnees.dateDebut <= donnees.dateFin, {
  message: 'dateDebut doit précéder ou être égal à dateFin.',
  path: ['dateDebut'],
});

// indicateurs=code1,code2 (chaîne unique séparée par des virgules, pas des paramètres répétés) :
// plus simple à construire côté front depuis un Set de codes sélectionnés
// (`[...selection].join(',')`) qu'un tableau de paramètres query, et sans dépendre de la
// configuration du parseur de query string d'Express pour les tableaux. La validation des codes
// eux-mêmes (statiques vs "poste:<code>") est laissée à statistiquesService (voir
// ErreurStatistiquesInvalide) : ce module frontière ne connaît pas le vocabulaire des indicateurs.
const dossiersQuerySchema = champsCommunsSchema
  .extend({
    indicateurs: z
      .string()
      .min(1)
      .transform((valeur) =>
        valeur
          .split(',')
          .map((code) => code.trim())
          .filter(Boolean),
      )
      .refine((codes) => codes.length > 0, { message: 'Au moins un indicateur requis.' }),
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

// GET /api/statistiques/kpi/dossiers?dateDebut=...&dateFin=...&typePoste=...&poste=...&indicateurs=code1,code2
// Tableau consolidé du dashboard KPI (cartes/segments cliquables, voir Indicateurs.jsx) : mêmes
// filtres période/poste que /kpi ci-dessus (doivent rester cohérents avec les chiffres déjà
// affichés), plus la liste des indicateurs sélectionnés. Dossiers dédupliqués, chacun annoté des
// indicateurs qu'il satisfait réellement (voir statistiquesService.listerDossiersParIndicateurs).
router.get('/kpi/dossiers', async (req, res, next) => {
  try {
    const { dateDebut, dateFin, typePoste, poste, indicateurs } = dossiersQuerySchema.parse(req.query);
    const dossiers = await statistiquesService.listerDossiersParIndicateurs(req.entite, {
      dateDebut,
      dateFin,
      typePoste,
      poste,
      indicateurs,
    });
    res.json({ dossiers });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    if (erreur instanceof statistiquesService.ErreurStatistiquesInvalide) {
      return res.status(400).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

module.exports = router;
