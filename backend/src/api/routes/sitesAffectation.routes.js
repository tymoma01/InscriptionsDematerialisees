const { Router } = require('express');
const { z } = require('zod');
const siteAffectationService = require('../../core/dpae/siteAffectationService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requirePermission } = require('../middlewares/rbac.middleware');
const entiteDpae = require('../../core/dpae/entiteDpae');
const { ENTITES } = require('../../core/auth/rbac');
const { aPermission } = require('../../core/auth/permissions');

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

// Secteur des sites visés par l'appelant : celui de son rôle (Tertiaire : sites du Tertiaire, Hôtellerie :
// liste historique) ; l'Admin choisit avec ?secteur=tertiaire (Hôtellerie par défaut).
function secteurDeLaRequete(req) {
  const entiteRole = entiteDpae.entiteDuRole(req.utilisateur.roleCode);
  if (entiteRole) return entiteRole === ENTITES.TERTIAIRE ? 'tertiaire' : 'hotellerie';
  return req.query.secteur === 'tertiaire' ? 'tertiaire' : 'hotellerie';
}

// Site du Tertiaire : nom (100 caractères au plus) et adresse facultative.
const siteTertiaireBodySchema = z.object({
  nom: z.string().trim().min(1, 'Le nom du site est obligatoire.').max(100, 'Le nom du site ne peut pas dépasser 100 caractères.'),
  adresse: z
    .string()
    .trim()
    .max(200, 'L’adresse ne peut pas dépasser 200 caractères.')
    .optional()
    .transform((valeur) => valeur || null),
  confirmerProche: z.boolean().optional(),
});
const idSchema = z.coerce.number().int().positive();
const siteRenommageSchema = z.object({ nom: siteTertiaireBodySchema.shape.nom });

async function tracer(req, action, cibleId, donnees) {
  const bd = await obtenirKnex();
  await journalAudit.enregistrerAction(bd, {
    utilisateurId: req.utilisateur.id,
    entiteId: req.entite.id,
    action,
    tableCible: 'sites_affectation',
    cibleId,
    donnees,
    adresseIp: req.ip,
  });
}

// Réponses d'erreur des sites du Tertiaire (messages affichés tels quels) ; true si traitée.
function repondreErreurSite(res, erreur) {
  if (erreur instanceof z.ZodError) {
    const message = erreur.issues[0]?.message;
    res.status(400).json({ erreur: message ?? 'Données invalides.', details: erreur.flatten() });
    return true;
  }
  if (erreur instanceof siteAffectationService.ErreurSiteProche) {
    res.status(409).json({ erreur: erreur.message, sitesProches: erreur.sitesProches, identique: erreur.identique });
    return true;
  }
  if (erreur instanceof siteAffectationService.ErreurSiteAffectationDoublon) {
    res.status(409).json({ erreur: erreur.message });
    return true;
  }
  if (erreur instanceof siteAffectationService.ErreurSiteIntrouvable) {
    res.status(404).json({ erreur: erreur.message });
    return true;
  }
  return false;
}

// GET /api/sites-affectation — sites actifs du secteur de l'appelant, triés par nom (liste du formulaire).
router.get('/', async (req, res, next) => {
  try {
    res.json(await siteAffectationService.listerSitesActifs(req.entite, secteurDeLaRequete(req)));
  } catch (erreur) {
    next(erreur);
  }
});

// POST /api/sites-affectation — ajout d'un site (bouton « + » du formulaire DPAE). Hôtellerie : nom et
// initiales, doublon -> 409. Tertiaire : nom et adresse, ouvert à tous les demandeurs du Tertiaire ; un site
// au nom identique ou proche -> 409 avec le site à choisir. Chaque ajout est tracé dans journal_audit.
router.post('/', async (req, res, next) => {
  try {
    if (secteurDeLaRequete(req) === 'tertiaire') {
      const { nom, adresse, confirmerProche } = siteTertiaireBodySchema.parse(req.body);
      const site = await siteAffectationService.creerSiteTertiaire(req.entite, { nom, adresse, creeParId: req.utilisateur.id, confirmerProche });
      await tracer(req, 'site_affectation_creation', site.id, { nom: site.nom, adresse: site.adresse, secteur: 'tertiaire' });
      return res.status(201).json(site);
    }

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
    if (repondreErreurSite(res, erreur)) return undefined;
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PATCH /api/sites-affectation/:id { nom } — renomme un site du Tertiaire, directement depuis la sélection des
// sites du formulaire (Planning Tertiaire, Admin). Refus 403 avec message pour les autres profils ; nom identique
// ou très proche d'un autre site : 409. Tracé (auteur, date, ancien et nouveau nom).
router.patch('/:id', async (req, res, next) => {
  try {
    if (!aPermission(req.utilisateur.roleCode, 'gestionSitesTertiaire')) {
      return res.status(403).json({ erreur: 'Seuls le Planning Tertiaire et l’Admin peuvent renommer un site.' });
    }
    const id = idSchema.parse(req.params.id);
    const { nom } = siteRenommageSchema.parse(req.body);
    const { avant, apres } = await siteAffectationService.renommerSiteTertiaire(req.entite, id, { nom });
    await tracer(req, 'site_affectation_renommage', id, { avant, apres });
    res.status(200).json({ id, nom });
  } catch (erreur) {
    if (!repondreErreurSite(res, erreur)) next(erreur);
  }
});

module.exports = router;
// Exposés pour sitesAffectation.routes.test.js (même convention que dossiers.routes.js : aucune
// infrastructure de test HTTP, on teste le VRAI schéma et la VRAIE liste de rôles montés ici).
module.exports.siteBodySchema = siteBodySchema;
module.exports.siteTertiaireBodySchema = siteTertiaireBodySchema;
