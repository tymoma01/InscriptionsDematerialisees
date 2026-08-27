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
// core/auth/rbac.js), l'admin consulte/agit aussi sur le dossier. Rôle Recruteur retiré (audit
// 2026-08-27) — voir suppression du rôle en base.
const ROLES_GESTION_RELANCES = [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN];

// Formateur/Inspecteur ajoutés ici UNIQUEMENT pour GET / ci-dessous (audit 2026-08-20, bouton
// "Voir le dossier" sur Suivi des tests, vue Formateur/Inspecteur) — jamais à POST, qui reste
// réservé à ROLES_GESTION_RELANCES : ces deux rôles consultent l'historique en lecture seule,
// sans pouvoir enregistrer de relance (formulaire masqué côté front, voir
// HistoriqueRelances.jsx, et de toute façon refusé ici côté serveur si contourné).
const ROLES_LECTURE_RELANCES = [...ROLES_GESTION_RELANCES, ROLES.FORMATEUR, ROLES.INSPECTEUR];

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

const relanceBodySchema = z.object({
  canal: z.enum(['sms', 'email', 'telephone']),
  // Les codes possibles (sans_reponse, injoignable, confirme...) ne sont volontairement pas
  // figés ici : ils viennent de la table `motifs` (categorie 'resultat_relance'), configurable
  // par entité (voir Modularité, CLAUDE.md — cf. scripts/seedMotifsRelance.js). Un code inconnu
  // pour l'entité courante est rejeté par relanceService, pas ici.
  // Optionnel : obligatoire uniquement pour le canal 'telephone' (choisi librement par l'agent) —
  // pour sms/email, relanceService l'ignore et le détermine lui-même d'après le succès/échec réel
  // de l'envoi (voir CANAUX_ENVOI_REEL, relanceService.js). La règle par canal est appliquée côté
  // service, pas ici.
  resultat: z.string().trim().min(1).optional(),
  // Note libre de l'agent, jamais obligatoire (contrairement au commentaire d'une transition de
  // statut, voir transitions.routes.js) — une relance reste valide sans, le canal/résultat suffit
  // à l'historique ("ne pas relancer en double").
  commentaire: z.string().trim().max(2000).optional(),
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
    const { canal, resultat, commentaire } = relanceBodySchema.parse(req.body);

    const resultatAction = await relanceService.enregistrerRelance(req.entite, {
      dossierId,
      canal,
      resultat,
      commentaire,
      utilisateurId: req.utilisateur.id,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'relance_creation',
      tableCible: 'relances',
      cibleId: resultatAction.relanceId,
      // resultatAction.resultat (pas la variable `resultat` du corps de requête) : pour sms/email,
      // le résultat réellement enregistré est déterminé par relanceService, pas fourni par le
      // client (voir relanceBodySchema ci-dessus).
      donnees: { dossierId, canal, resultat: resultatAction.resultat, commentaire: commentaire ?? null },
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
router.get('/', requireRole(...ROLES_LECTURE_RELANCES), async (req, res, next) => {
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
