const { Router } = require('express');
const { z } = require('zod');
const utilisateurService = require('../../core/auth/utilisateurService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/utilisateurs' (voir app.js) — top-level, pas nichée sous un dossier : la
// gestion des comptes n'est scopée par rien d'autre que l'entité courante (voir entiteContext).
const router = Router();

// Gestion des comptes (CLAUDE.md, section Rôles : "Admin : gestion globale") — admin uniquement,
// contrairement aux autres routeurs de ce projet qui listent plusieurs rôles.
router.use(requireAuth);
router.use(requireRole(ROLES.ADMIN));

const idPositifSchema = z.coerce.number().int().positive();

const MOT_DE_PASSE_MIN = 8;

const creationSchema = z.object({
  nom: z.string().trim().min(1),
  prenom: z.string().trim().min(1),
  email: z.string().trim().email(),
  motDePasse: z.string().min(MOT_DE_PASSE_MIN, `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères.`),
  // Le code de rôle n'est jamais figé ici : il vient de la table `roles` (globale, voir rbac.js)
  // — un code inconnu ou "systeme" est rejeté par utilisateurService, pas ici.
  roleCode: z.string().trim().min(1),
});

const miseAJourSchema = z.object({
  nom: z.string().trim().min(1).optional(),
  prenom: z.string().trim().min(1).optional(),
  roleCode: z.string().trim().min(1).optional(),
  actif: z.boolean().optional(),
  // Optionnel : ne change le mot de passe que si explicitement fourni, sans quoi une simple
  // modification du rôle/nom obligerait à en resaisir un.
  motDePasse: z.string().min(MOT_DE_PASSE_MIN, `Le mot de passe doit contenir au moins ${MOT_DE_PASSE_MIN} caractères.`).optional(),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// Réponse volontairement restreinte (jamais mot_de_passe_hash, jamais role_id brut) — même
// principe que construireUtilisateurSession dans authService.js.
function serialiserUtilisateur(utilisateur) {
  return {
    id: utilisateur.id,
    nom: utilisateur.nom,
    prenom: utilisateur.prenom,
    email: utilisateur.email,
    actif: utilisateur.actif,
  };
}

// GET /api/utilisateurs/roles — rôles assignables (systeme exclu), pour construire le
// sélecteur du formulaire sans coder de code de rôle en dur côté front.
router.get('/roles', async (req, res, next) => {
  try {
    const roles = await utilisateurService.listerRolesAssignables();
    res.json(roles);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/utilisateurs — comptes de l'entité courante (systeme exclu).
router.get('/', async (req, res, next) => {
  try {
    const utilisateurs = await utilisateurService.listerUtilisateurs(req.entite);
    res.json(utilisateurs);
  } catch (erreur) {
    next(erreur);
  }
});

// POST /api/utilisateurs — crée un compte pour l'entité courante.
router.post('/', async (req, res, next) => {
  try {
    const donnees = creationSchema.parse(req.body);
    const utilisateur = await utilisateurService.creerUtilisateur(req.entite, donnees);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'utilisateur_creation',
      tableCible: 'utilisateurs',
      cibleId: utilisateur.id,
      donnees: { email: donnees.email, roleCode: donnees.roleCode },
      adresseIp: req.ip,
    });

    res.status(201).json(serialiserUtilisateur(utilisateur));
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PATCH /api/utilisateurs/:id — met à jour nom/prénom/rôle/statut actif/mot de passe (tous
// optionnels) ; pas de suppression physique exposée (voir utilisateurService.js).
router.patch('/:id', async (req, res, next) => {
  try {
    const utilisateurId = idPositifSchema.parse(req.params.id);
    const donnees = miseAJourSchema.parse(req.body);

    const utilisateur = await utilisateurService.mettreAJourUtilisateur(
      req.entite,
      utilisateurId,
      donnees,
      req.utilisateur.id,
    );

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'utilisateur_maj',
      tableCible: 'utilisateurs',
      cibleId: utilisateurId,
      // Le mot de passe lui-même ne doit jamais atterrir dans le journal d'audit, même haché —
      // seule sa présence/absence est utile pour l'historique.
      donnees: { ...donnees, motDePasse: donnees.motDePasse ? '(changé)' : undefined },
      adresseIp: req.ip,
    });

    res.json(serialiserUtilisateur(utilisateur));
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
