const { Router } = require('express');
const { z } = require('zod');
const rendezvousService = require('../../core/rendezvous/rendezvousService');
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
