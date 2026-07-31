const { Router } = require('express');
const { z } = require('zod');
const rendezvousService = require('../../core/rendezvous/rendezvousService');
const { ErreurFormateurInvalide, ErreurCreneauPris, ErreurDatePassee, ErreurReplanificationTropTardive } =
  rendezvousService;
const planificationRendezvousService = require('../../core/rendezvous/planificationRendezvousService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers/:dossierId/rendezvous' (voir app.js) — `mergeParams: true`
// indispensable pour que req.params.dossierId reste visible ici, même patron que
// pieces.routes.js / relances.routes.js.
const router = Router({ mergeParams: true });

// Reprogrammations et désistements (CLAUDE.md, besoins Accueil/Coordination : "relances et
// reprogrammations" ; "motif de désistement enregistré systématiquement") — mêmes rôles que la
// gestion des pièces justificatives et des relances.
const ROLES_GESTION_RENDEZVOUS = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

const statutBodySchema = z.object({
  statut: z.enum(['prevu', 'confirme', 'absent', 'annule']),
  // Obligatoire uniquement pour 'absent'/'annule' — vérifié par rendezvousService, pas ici
  // (c'est lui qui connaît la règle "systématique", pas la couche de validation de forme).
  motifCode: z.string().trim().min(1).optional(),
});

// typeRdv volontairement pas une enum figée ici (voir migration 018 : colonne string sans
// contrainte CHECK) — un rendez-vous n'est pas forcément un test (CLAUDE.md prévoit aussi un
// rendez-vous de signature de contrat en fin de formation), et le moteur générique ne fige pas
// le vocabulaire métier d'une entité (voir Modularité, CLAUDE.md).
// postesSelectionnes (Phase 1, informatif — voir rendezvousService.creerRendezvous) : optionnel,
// défaut tableau vide (même défaut que la colonne `rendezvous.postes_selectionnes`, migration
// 039). Codes libres ici, pas un enum figé : ce sont des codes de postes propres à ACCECIT (voir
// Modularité, CLAUDE.md), cette couche générique ne les connaît pas.
const creationRendezvousSchema = z.object({
  typeRdv: z.string().trim().min(1),
  dateHeure: z.string().trim().datetime({ offset: true }),
  formateurId: idPositifSchema.optional(),
  postesSelectionnes: z.array(z.string().trim().min(1)).default([]),
});

// Une transition à appliquer juste après la création du rendez-vous, dans la même transaction
// (voir planificationRendezvousService.js) — codeAction pas figé en enum ici, même principe que
// transitions.routes.js : le moteur générique valide la légitimité de l'action, pas cette couche.
const transitionAAppliquerSchema = z.object({
  codeAction: z.string().trim().min(1),
  motifCode: z.string().trim().min(1).optional(),
  commentaire: z.string().trim().min(1),
});

const creationAvecTransitionsSchema = creationRendezvousSchema.extend({
  // Ordonnée : appliquée dans l'ordre reçu (ex. ACCECIT : "pieces_completes" puis
  // "planifier_test" — voir CaptureTablette.jsx). Au moins une transition, sinon autant utiliser
  // POST / ci-dessus (création seule, sans transition).
  transitions: z.array(transitionAAppliquerSchema).min(1),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// GET /api/dossiers/:dossierId/rendezvous — rendez-vous du dossier, du plus récent au plus ancien.
router.get('/', requireRole(...ROLES_GESTION_RENDEZVOUS), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const rendezvous = await rendezvousService.listerRendezvous(req.entite, dossierId);
    res.json(rendezvous);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// POST /api/dossiers/:dossierId/rendezvous — planifie un nouveau rendez-vous pour le dossier
// (ex. rendez-vous de test, CLAUDE.md étape "Envoi en test"). formateurId optionnel, mais s'il
// est fourni doit référencer un utilisateur de cette entité ayant le rôle formateur (voir
// rendezvousService.creerRendezvous) — c'est lui qui verra ensuite ce rendez-vous dans
// GET /api/evaluations/a-faire. Ne déclenche aucune transition de statut du dossier ici — pour un
// rendez-vous qui doit s'accompagner d'un changement de statut atomique (ex. planification de
// test), voir POST /avec-transitions ci-dessous plutôt que d'enchaîner cet endpoint avec
// POST /api/dossiers/:dossierId/transitions séparément (non atomique, voir son historique).
router.post('/', requireRole(...ROLES_GESTION_RENDEZVOUS), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const { typeRdv, dateHeure, formateurId, postesSelectionnes } = creationRendezvousSchema.parse(req.body);

    const rendezvous = await rendezvousService.creerRendezvous(req.entite, {
      dossierId,
      typeRdv,
      dateHeure,
      formateurId,
      postesSelectionnes,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'rendezvous_cree',
      tableCible: 'rendezvous',
      cibleId: rendezvous.id,
      donnees: { dossierId, typeRdv, dateHeure, formateurId: formateurId ?? null, postesSelectionnes },
      adresseIp: req.ip,
    });

    res.status(201).json(rendezvous);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurFormateurInvalide) {
      return res.status(400).json({ erreur: erreur.message });
    }
    if (erreur instanceof ErreurCreneauPris) {
      return res.status(409).json({ erreur: erreur.message });
    }
    if (erreur instanceof ErreurDatePassee) {
      return res.status(400).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

// POST /api/dossiers/:dossierId/rendezvous/avec-transitions — même création de rendez-vous que
// POST / ci-dessus, mais applique en plus une ou plusieurs transitions de statut dans la MÊME
// transaction DB (voir planificationRendezvousService.js) : soit tout réussit, soit rien n'est
// écrit — corrige l'incident du dossier 62 (rendez-vous créés sans le changement de statut
// attendu, après plusieurs tentatives ayant chacune échoué sur la transition uniquement).
router.post('/avec-transitions', requireRole(...ROLES_GESTION_RENDEZVOUS), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const { typeRdv, dateHeure, formateurId, postesSelectionnes, transitions } =
      creationAvecTransitionsSchema.parse(req.body);

    const resultat = await planificationRendezvousService.planifierRendezvousAvecTransitions(req.entite, {
      dossierId,
      typeRdv,
      dateHeure,
      formateurId,
      postesSelectionnes,
      transitions,
      utilisateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'rendezvous_cree_avec_transitions',
      tableCible: 'rendezvous',
      cibleId: resultat.rendezvous.id,
      donnees: {
        dossierId,
        typeRdv,
        dateHeure,
        formateurId: formateurId ?? null,
        postesSelectionnes,
        codesActions: transitions.map((transition) => transition.codeAction),
      },
      adresseIp: req.ip,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurFormateurInvalide) {
      return res.status(400).json({ erreur: erreur.message });
    }
    if (erreur instanceof ErreurCreneauPris) {
      return res.status(409).json({ erreur: erreur.message });
    }
    if (erreur instanceof ErreurDatePassee) {
      return res.status(400).json({ erreur: erreur.message });
    }
    if (erreur instanceof ErreurReplanificationTropTardive) {
      return res.status(409).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

// PATCH /api/dossiers/:dossierId/rendezvous/:rendezvousId — change le statut d'un rendez-vous ;
// passer à 'absent' ou 'annule' sans motif valide est rejeté (voir rendezvousService.js).
router.patch('/:rendezvousId', requireRole(...ROLES_GESTION_RENDEZVOUS), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const rendezvousId = idPositifSchema.parse(req.params.rendezvousId);
    const { statut, motifCode } = statutBodySchema.parse(req.body);

    const rendezvous = await rendezvousService.changerStatutRendezvous(req.entite, {
      dossierId,
      rendezvousId,
      statut,
      motifCode,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: `rendezvous_statut_${statut}`,
      tableCible: 'rendezvous',
      cibleId: rendezvousId,
      donnees: { dossierId, statut, motifCode },
      adresseIp: req.ip,
    });

    res.json(rendezvous);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
