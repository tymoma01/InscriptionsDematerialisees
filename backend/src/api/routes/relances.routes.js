const { Router } = require('express');
const { z } = require('zod');
const relanceService = require('../../core/dossier/relanceService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers/:dossierId/relances' (voir app.js) — `mergeParams: true` indispensable
// pour que req.params.dossierId reste visible ici, même patron que pieces.routes.js.
const router = Router({ mergeParams: true });

// Historique des relances (CLAUDE.md, besoin Accueil/Coordination : "historique des relances par
// candidat, pour ne pas relancer en double") — mêmes rôles que la gestion des pièces
// justificatives : accueil et coordination sont un seul rôle (ROLES.ACCUEIL_COORDINATION, voir
// core/auth/rbac.js), le recruteur et l'admin consultent/agissent aussi sur le dossier.
const ROLES_GESTION_RELANCES = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

const relanceBodySchema = z.object({
  canal: z.enum(['sms', 'email', 'telephone']),
  // Les codes possibles (sans_reponse, injoignable, confirme...) ne sont volontairement pas
  // figés ici : ils viennent de la table `motifs` (categorie 'resultat_relance'), configurable
  // par entité (voir Modularité, CLAUDE.md — cf. scripts/seedMotifsRelance.js). Un code inconnu
  // pour l'entité courante est rejeté par relanceService, pas ici.
  resultat: z.string().trim().min(1),
  // utilisateurId n'est jamais lu ici : il vient de req.utilisateur.id (session serveur), jamais
  // du corps de la requête envoyé par le client — même principe que uploadedBy pour les pièces
  // justificatives (voir pieces.routes.js et CLAUDE.auth-rbac.md).
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// POST /api/dossiers/:dossierId/relances — enregistre une relance effectuée sur ce dossier.
router.post('/', requireRole(...ROLES_GESTION_RELANCES), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const { canal, resultat } = relanceBodySchema.parse(req.body);

    const resultatAction = await relanceService.enregistrerRelance(req.entite, {
      dossierId,
      canal,
      resultat,
      utilisateurId: req.utilisateur.id,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'relance_creation',
      tableCible: 'relances',
      cibleId: resultatAction.relanceId,
      donnees: { dossierId, canal, resultat },
      adresseIp: req.ip,
    });

    res.status(201).json(resultatAction);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/relances — historique des relances du dossier, du plus récent au
// plus ancien : c'est cet historique qui doit être consulté avant de relancer à nouveau.
router.get('/', requireRole(...ROLES_GESTION_RELANCES), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const relances = await relanceService.listerRelances(req.entite, dossierId);
    res.json(relances);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
