const { Router } = require('express');
const { z } = require('zod');
const workflowEngine = require('../../core/workflow/workflowEngine');
const { cloturerRendezvousAvecTransition } = require('../../core/rendezvous/clotureRendezvousAvecTransitionService');
const { ErreurRendezvousDossierClos } = require('../../core/rendezvous/rendezvousService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers/:dossierId/transitions' (voir app.js) — `mergeParams: true`
// indispensable pour que req.params.dossierId reste visible ici, même patron que
// pieces.routes.js / relances.routes.js / rendezvous.routes.js.
const router = Router({ mergeParams: true });

// Décision sur le dossier (valider/rejeter, workflow hérité conservé le temps de clore les 2
// derniers dossiers via l'ancien circuit, voir migrerWorkflowAccecitV3.js) comme les étapes
// intermédiaires du parcours (accueil confirmant que les pièces sont complètes). FORMATEUR/
// INSPECTEUR ajoutés pour valider_envoi_formation/valider_pret_embauche/invalider_test (voir
// GrilleEvaluation.jsx : la soumission d'une évaluation fait avancer le dossier directement
// jusqu'à son issue finale, workflow v3/v4). Ce gate de route reste volontairement large (tous les
// rôles internes susceptibles d'agir sur un dossier) : c'est un filtre grossier et bon marché avant
// même de toucher la base — le contrôle fin "quel rôle peut déclencher quelle transition précise"
// est fait par workflowEngine via `transition_roles` (migration 006), pas ici : un formateur/
// inspecteur reste incapable de déclencher valider_dossier/pieces_completes/etc., faute de ligne
// transition_roles pour ces couples-là. Défense en profondeur : les deux niveaux sont
// complémentaires, ni redondants ni contradictoires. Rôle Recruteur retiré (audit 2026-08-27) —
// voir suppression du rôle en base.
const ROLES_GESTION_TRANSITIONS = [ROLES.ACCUEIL_COORDINATION, ROLES.FORMATEUR, ROLES.INSPECTEUR, ROLES.ADMIN];

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

const transitionBodySchema = z.object({
  codeAction: z.string().trim().min(1),
  // Obligatoire uniquement si la transition le requiert (transitions_statut.motif_requis) —
  // vérifié par workflowEngine, pas ici : c'est lui qui connaît la config de l'entité.
  motifCode: z.string().trim().min(1).optional(),
  commentaire: z.string().trim().min(1),
  // Trois champs optionnels ajoutés (audit 2026-08-20, dossier #84) pour fermer ATOMIQUEMENT le
  // rendez-vous associé en même temps que cette transition — voir marquerNonRealise
  // (ListeEvaluationsAFaire.jsx, bouton manuel "Test non réalisé"), seul appelant actuel. Absents
  // par défaut : la route reste utilisable telle quelle par tout autre appelant qui ne concerne
  // aucun rendez-vous (ex. valider_dossier, pieces_completes...). rendezvousId reste soumis au
  // même garde-fou IDOR que PATCH /rendezvous/:id (voir rendezvousService.changerStatutRendezvous,
  // qui revérifie que ce rendez-vous appartient bien à ce dossier).
  rendezvousId: z.coerce.number().int().positive().optional(),
  statutRendezvous: z.enum(['prevu', 'confirme', 'absent', 'annule']).optional(),
  motifCodeRendezvous: z.string().trim().min(1).optional(),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// GET /api/dossiers/:dossierId/transitions — actions possibles depuis le statut courant du
// dossier, pour que le front sache quels boutons proposer.
router.get('/', requireRole(...ROLES_GESTION_TRANSITIONS), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const transitions = await workflowEngine.listerTransitionsDisponibles(req.entite, dossierId, req.utilisateur.roleCode);
    res.json(transitions);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// POST /api/dossiers/:dossierId/transitions — applique une transition (codeAction) sur le
// dossier ; refusée si l'action n'est pas permise depuis le statut courant, ou si un motif est
// requis et absent/invalide (voir workflowEngine.appliquerTransition).
router.post('/', requireRole(...ROLES_GESTION_TRANSITIONS), async (req, res, next) => {
  try {
    const dossierId = idPositifSchema.parse(req.params.dossierId);
    const { codeAction, motifCode, commentaire, rendezvousId, statutRendezvous, motifCodeRendezvous } =
      transitionBodySchema.parse(req.body);

    // rendezvousId présent : ferme ce rendez-vous ET applique la transition en une seule
    // transaction (voir clotureRendezvousAvecTransitionService.js) — sinon, comportement inchangé
    // (transition seule, comme avant cet ajout).
    const resultat = rendezvousId
      ? await cloturerRendezvousAvecTransition(req.entite, {
          dossierId,
          rendezvousId,
          statutRendezvous,
          motifCodeRendezvous,
          transitions: [{ codeAction, motifCode, commentaire }],
          utilisateurId: req.utilisateur.id,
          roleCode: req.utilisateur.roleCode,
        })
      : await workflowEngine.appliquerTransition(req.entite, {
          dossierId,
          codeAction,
          motifCode,
          commentaire,
          utilisateurId: req.utilisateur.id,
          roleCode: req.utilisateur.roleCode,
        });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: `dossier_transition_${codeAction}`,
      tableCible: 'historique_statuts',
      cibleId: dossierId,
      donnees: { dossierId, codeAction, motifCode, commentaire },
      adresseIp: req.ip,
    });
    if (rendezvousId) {
      // Journalisé séparément (même patron que PATCH /rendezvous/:id, rendezvous.routes.js) :
      // action distincte sur une table distincte, traçable indépendamment de la transition dossier
      // ci-dessus même si les deux ont été appliquées atomiquement.
      await journalAudit.enregistrerAction(bd, {
        utilisateurId: req.utilisateur.id,
        entiteId: req.entite.id,
        action: `rendezvous_statut_${statutRendezvous}`,
        tableCible: 'rendezvous',
        cibleId: rendezvousId,
        donnees: { dossierId, statut: statutRendezvous, motifCode: motifCodeRendezvous },
        adresseIp: req.ip,
      });
    }

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof ErreurRendezvousDossierClos) {
      return res.status(409).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

module.exports = router;
