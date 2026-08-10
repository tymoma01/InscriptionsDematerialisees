const { Router } = require('express');
const { z } = require('zod');
const lieuService = require('../../core/lieux/lieuService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
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

// GET /api/lieux/:lieuId/rendezvous — rendez-vous encore associés à ce lieu ({ id, dateHeure,
// candidatNom, candidatPrenom }[]), utilisé par le bouton poubelle de ModalePlanificationTest.jsx
// pour décider entre confirmation simple (tableau vide) et panneau de migration (au moins une
// entrée) avant même de tenter la suppression.
router.get('/:lieuId/rendezvous', async (req, res, next) => {
  try {
    const lieuId = idPositifSchema.parse(req.params.lieuId);
    const rendezvousAssocies = await lieuService.listerRendezvousAssocies(req.entite, lieuId);
    res.json(rendezvousAssocies);
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

// lieuDestinationId optionnel côté schéma : obligatoire seulement si le lieu est encore associé à
// des rendez-vous, une règle métier que lieuService.supprimerLieu est seul à connaître (voir
// ErreurMigrationRequise) — pas dupliquée ici.
const suppressionLieuSchema = z.object({
  lieuDestinationId: idPositifSchema.optional(),
});

// DELETE /api/lieux/:lieuId — supprime un lieu de l'entité courante, en migrant au préalable tout
// rendez-vous encore associé vers `lieuDestinationId` si fourni (une seule transaction côté
// service, voir lieuService.supprimerLieu). Journalise APRÈS l'appel au service (convention du
// projet, voir rendezvous.routes.js/utilisateurs.routes.js) : une entrée si suppression directe,
// deux si migration (déplacement en masse + suppression), avec `bd` — jamais dans la transaction
// qui vient de se refermer côté service.
router.delete('/:lieuId', async (req, res, next) => {
  try {
    const lieuId = idPositifSchema.parse(req.params.lieuId);
    const { lieuDestinationId } = suppressionLieuSchema.parse(req.body ?? {});

    const resultat = await lieuService.supprimerLieu(req.entite, lieuId, { lieuDestinationId });

    const bd = await obtenirKnex();
    if (resultat.rendezvousMigres > 0) {
      await journalAudit.enregistrerAction(bd, {
        utilisateurId: req.utilisateur.id,
        entiteId: req.entite.id,
        action: 'rendezvous_migration_masse',
        tableCible: 'rendezvous',
        cibleId: resultat.lieuDestination.id,
        donnees: {
          lieuOrigineId: lieuId,
          lieuOrigineLibelle: resultat.lieu.libelle,
          lieuDestinationId: resultat.lieuDestination.id,
          lieuDestinationLibelle: resultat.lieuDestination.libelle,
          rendezvousMigres: resultat.rendezvousAssocies,
          notifications: resultat.notifications,
        },
        adresseIp: req.ip,
      });
    }
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'lieu_suppression',
      tableCible: 'lieux',
      cibleId: lieuId,
      donnees: {
        libelle: resultat.lieu.libelle,
        migreVersLieuId: resultat.lieuDestination?.id ?? null,
        rendezvousMigres: resultat.rendezvousMigres,
      },
      adresseIp: req.ip,
    });

    res.json({ rendezvousMigres: resultat.rendezvousMigres });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    if (erreur instanceof lieuService.ErreurLieuIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof lieuService.ErreurMigrationRequise) {
      return res.status(409).json({ erreur: erreur.message, rendezvousAssocies: erreur.rendezvousAssocies });
    }
    if (erreur instanceof lieuService.ErreurLieuDestinationInvalide) {
      return res.status(400).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

module.exports = router;
