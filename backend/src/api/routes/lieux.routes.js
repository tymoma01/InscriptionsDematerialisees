const { Router } = require('express');
const { z } = require('zod');
const lieuService = require('../../core/lieux/lieuService');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/lieux' (voir app.js) — top-level, même patron que formateurs.routes.js : un
// agent Accueil/Coordination ou Recruteur doit pouvoir lister les lieux pour planifier un
// rendez-vous de test (voir ModalePlanificationTest.jsx) sans avoir de droits d'administration.
// Mêmes rôles pour la création (voir POST ci-dessous) : c'est justement l'agent Accueil qui a
// besoin de créer un lieu à la volée pendant la planification, pas seulement l'Admin — voir bouton
// "+" à côté du sélecteur de lieu, ModalePlanificationTest.jsx.
const router = Router();

const ROLES_GESTION_LIEUX = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_GESTION_LIEUX));

// GET /api/lieux — lieux actifs de l'entité courante ({ id, code, libelle }).
router.get('/', async (req, res, next) => {
  try {
    const lieux = await lieuService.listerLieuxActifs(req.entite);
    res.json(lieux);
  } catch (erreur) {
    next(erreur);
  }
});

// libelle porte l'adresse en texte libre (voir lieuService.creerLieu) : pas de champ adresse
// séparé, la table `lieux` (migration 044) n'en a pas.
const creationLieuSchema = z.object({
  libelle: z.string().trim().min(1),
});

// POST /api/lieux — crée un lieu pour l'entité courante et le renvoie ({ id, code, libelle,
// actif }), utilisé par ModalePlanificationTest.jsx pour l'ajouter et le sélectionner
// immédiatement sans recharger la liste.
router.post('/', async (req, res, next) => {
  try {
    const { libelle } = creationLieuSchema.parse(req.body);
    const lieu = await lieuService.creerLieu(req.entite, { libelle });
    res.status(201).json(lieu);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

const idPositifSchema = z.coerce.number().int().positive();

// Même schéma que la création (seul champ modifiable) — voir lieuService.modifierLieu.
const modificationLieuSchema = z.object({
  libelle: z.string().trim().min(1),
});

// PATCH /api/lieux/:lieuId — modifie le libellé d'un lieu existant de l'entité courante et le
// renvoie ({ id, code, libelle, actif }), utilisé par le bouton crayon de
// ModalePlanificationTest.jsx pour l'appliquer et le refléter immédiatement dans le sélecteur sans
// recharger la liste. 404 si le lieu n'existe pas ou appartient à une autre entité (voir
// lieuService.ErreurLieuIntrouvable, même IDOR-guard que le reste de lieuRepository.js).
router.patch('/:lieuId', async (req, res, next) => {
  try {
    const lieuId = idPositifSchema.parse(req.params.lieuId);
    const { libelle } = modificationLieuSchema.parse(req.body);
    const lieu = await lieuService.modifierLieu(req.entite, lieuId, { libelle });
    res.json(lieu);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    if (erreur instanceof lieuService.ErreurLieuIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

module.exports = router;
