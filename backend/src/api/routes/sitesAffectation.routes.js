const { Router } = require('express');
const { z } = require('zod');
const siteAffectationService = require('../../core/dpae/siteAffectationService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requirePermission } = require('../middlewares/rbac.middleware');

// Monté sur '/api/sites-affectation' (voir app.js) — référentiel des sites d'affectation des
// demandes DPAE (migration 069). Lecture ET ajout réservés aux rôles qui peuvent créer une DPAE
// (Planning et Admin depuis le 2026-09-30 — Accueil/Coordination n'a plus aucun accès DPAE, voir
// rbac.js dpaeCreation) : ce référentiel n'est utilisé que dans ce formulaire ; la
// fiche RH reçoit les sites d'une demande avec la demande elle-même (voir demandeDpaeService).
const router = Router();


router.use(requireAuth);
router.use(requirePermission('dpaeCreation'));

// Initiales : majuscules et chiffres uniquement, 2 à 5 caractères (demande utilisateur) — contrôle
// strict, sans mise en majuscules automatique côté serveur (le formulaire s'en charge à la saisie).
const siteBodySchema = z.object({
  nom: z.string().trim().min(1, 'Le nom du site est obligatoire.'),
  initiales: z
    .string()
    .trim()
    .min(1, 'Les initiales sont obligatoires.')
    .regex(/^[A-Z0-9]{2,5}$/, 'Les initiales doivent contenir de 2 à 5 caractères, en majuscules et chiffres uniquement.'),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// GET /api/sites-affectation — sites actifs de l'entité, triés par nom.
router.get('/', async (req, res, next) => {
  try {
    res.json(await siteAffectationService.listerSitesActifs(req.entite));
  } catch (erreur) {
    next(erreur);
  }
});

// POST /api/sites-affectation — ajout d'un site (bouton « + » du formulaire DPAE). Doublon de nom
// ou d'initiales -> 409 avec un message explicite. Chaque ajout est tracé dans journal_audit.
router.post('/', async (req, res, next) => {
  try {
    const { nom, initiales } = siteBodySchema.parse(req.body);
    const site = await siteAffectationService.creerSite(req.entite, { nom, initiales });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'site_affectation_creation',
      tableCible: 'sites_affectation',
      cibleId: site.id,
      donnees: { nom: site.nom, initiales: site.initiales },
      adresseIp: req.ip,
    });

    res.status(201).json(site);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof siteAffectationService.ErreurSiteAffectationDoublon) {
      return res.status(409).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

module.exports = router;
// Exposés pour sitesAffectation.routes.test.js (même convention que dossiers.routes.js : aucune
// infrastructure de test HTTP, on teste le VRAI schéma et la VRAIE liste de rôles montés ici).
module.exports.siteBodySchema = siteBodySchema;
