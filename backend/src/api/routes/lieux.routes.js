const { Router } = require('express');
const { z } = require('zod');
const lieuService = require('../../core/lieux/lieuService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/lieux' (voir app.js) — top-level, même patron que formateurs.routes.js : un
// agent Accueil/Coordination doit pouvoir lister les lieux pour planifier un rendez-vous de test
// (voir ModalePlanificationTest.jsx) sans avoir de droits d'administration. Mêmes rôles pour la
// création (voir POST ci-dessous) : c'est justement l'agent Accueil qui a besoin de créer un lieu
// à la volée pendant la planification, pas seulement l'Admin — voir bouton "+" à côté du
// sélecteur de lieu, ModalePlanificationTest.jsx.
const router = Router();

// Rôle Recruteur retiré (audit 2026-08-27) — voir suppression du rôle en base.
const ROLES_GESTION_LIEUX = [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_GESTION_LIEUX));

// GET /api/lieux — lieux actifs de l'entité courante ({ id, code, adresse, metro_acces,
// instructions, actif }).
router.get('/', async (req, res, next) => {
  try {
    const lieux = await lieuService.listerLieuxActifs(req.entite);
    res.json(lieux);
  } catch (erreur) {
    next(erreur);
  }
});

// Trois champs structurés depuis la migration 047 (remplace l'ancien `libelle` texte libre, voir
// audit du 2026-08-13) : `adresse` identifie le lieu physique (seul champ obligatoire),
// `metroAcces`/`instructions` sont des compléments optionnels — voir lieuService.creerLieu.
// `secteur`/`parDefaut` (migration 054, audit 2026-08-27) : mêmes deux valeurs déjà en dur ailleurs
// dans le moteur ('bureau'/'hotel', voir rendezvousService.js/ModalePlanificationTest.jsx), pas un
// enum de config par entité (voir Modularité, CLAUDE.md — même choix que secteurDossier côté
// front). `parDefaut` coché ("Définir comme lieu par défaut pour ce secteur") exige `secteur` :
// sans lui, rien à basculer (voir lieuRepository.definirLieuParDefaut, qui a besoin du secteur
// pour savoir QUEL ancien défaut désactiver) — refusé ici plutôt que silencieusement ignoré.
const creationLieuSchema = z
  .object({
    adresse: z.string().trim().min(1),
    metroAcces: z.string().trim().optional(),
    instructions: z.string().trim().optional(),
    secteur: z.enum(['bureau', 'hotel']).optional(),
    parDefaut: z.boolean().optional(),
  })
  .refine((valeurs) => !valeurs.parDefaut || Boolean(valeurs.secteur), {
    message: 'Un secteur est requis pour définir ce lieu comme lieu par défaut.',
    path: ['secteur'],
  });

// POST /api/lieux — crée un lieu pour l'entité courante et le renvoie ({ id, code, adresse,
// metro_acces, instructions, actif, secteur, par_defaut }), utilisé par ModalePlanificationTest.jsx
// pour l'ajouter et le sélectionner immédiatement sans recharger la liste.
router.post('/', async (req, res, next) => {
  try {
    const { adresse, metroAcces, instructions, secteur, parDefaut } = creationLieuSchema.parse(req.body);
    const lieu = await lieuService.creerLieu(req.entite, { adresse, metroAcces, instructions, secteur, parDefaut });
    res.status(201).json(lieu);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

const idPositifSchema = z.coerce.number().int().positive();

// Même schéma que la création (mêmes champs modifiables) — voir lieuService.modifierLieu.
const modificationLieuSchema = z.object({
  adresse: z.string().trim().min(1),
  metroAcces: z.string().trim().optional(),
  instructions: z.string().trim().optional(),
});

// PATCH /api/lieux/:lieuId — modifie un lieu existant de l'entité courante et le renvoie ({ id,
// code, adresse, metro_acces, instructions, actif }), utilisé par le bouton crayon de
// ModalePlanificationTest.jsx pour l'appliquer et le refléter immédiatement dans le sélecteur sans
// recharger la liste. 404 si le lieu n'existe pas ou appartient à une autre entité (voir
// lieuService.ErreurLieuIntrouvable, même IDOR-guard que le reste de lieuRepository.js).
router.patch('/:lieuId', async (req, res, next) => {
  try {
    const lieuId = idPositifSchema.parse(req.params.lieuId);
    const { adresse, metroAcces, instructions } = modificationLieuSchema.parse(req.body);
    const lieu = await lieuService.modifierLieu(req.entite, lieuId, { adresse, metroAcces, instructions });
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
        // Champs séparés depuis la migration 047 (remplace le "Libelle" combiné) — cohérent avec
        // la traçabilité RGPD déjà en place ailleurs (qui/quoi/quand) : conserve la même
        // granularité que les colonnes réellement modifiées, plutôt qu'une chaîne reconstruite qui
        // masquerait quel champ précis a changé.
        donnees: {
          lieuOrigineId: lieuId,
          lieuOrigineAdresse: resultat.lieu.adresse,
          lieuOrigineMetroAcces: resultat.lieu.metro_acces,
          lieuOrigineInstructions: resultat.lieu.instructions,
          lieuDestinationId: resultat.lieuDestination.id,
          lieuDestinationAdresse: resultat.lieuDestination.adresse,
          lieuDestinationMetroAcces: resultat.lieuDestination.metro_acces,
          lieuDestinationInstructions: resultat.lieuDestination.instructions,
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
        adresse: resultat.lieu.adresse,
        metroAcces: resultat.lieu.metro_acces,
        instructions: resultat.lieu.instructions,
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
