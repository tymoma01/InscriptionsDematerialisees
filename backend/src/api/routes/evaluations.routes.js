const { Router } = require('express');
const { z } = require('zod');
const evaluationEngine = require('../../core/evaluation/evaluationEngine');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/evaluations' (voir app.js) — top-level, pas nichée sous '/api/dossiers/:id'
// comme pieces/relances/rendezvous : le point d'entrée du formateur est sa propre liste de
// rendez-vous de test à évaluer (potentiellement répartis sur plusieurs dossiers), pas un
// dossier particulier.
const router = Router();

// Évaluation du test (CLAUDE.md, section Rôles : "Formateur ... évalue les candidats, valide/
// invalide le test") — admin inclus par cohérence avec son rôle de gestion globale, comme
// partout ailleurs dans le projet.
const ROLES_EVALUATION = [ROLES.FORMATEUR, ROLES.ADMIN];

router.use(requireAuth);
router.use(requireRole(...ROLES_EVALUATION));

const idPositifSchema = z.coerce.number().int().positive();

const evaluationBodySchema = z.object({
  rendezvousId: idPositifSchema,
  resultatGlobal: z.enum(['valide', 'invalide']),
  // Sans objet si resultatGlobal vaut 'invalide' — la présence/validité pour un verdict positif
  // est revérifiée par evaluationEngine, pas ici (voir Modularité, CLAUDE.md : ce schéma ne fait
  // que la forme, jamais la règle métier).
  orientation: z.enum(['envoi_formation', 'pret_embauche']).optional(),
  commentaire: z.string().trim().min(1),
  // Les codes de critère ne sont volontairement pas figés ici : ils viennent de
  // `criteres_evaluation`, configurable par entité — un code inconnu ou une grille incomplète
  // est rejetée par evaluationEngine, pas ici (voir Modularité, CLAUDE.md).
  criteres: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        valeur: z.enum(['conforme', 'a_ameliorer', 'non_conforme']),
      }),
    )
    .min(1),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// GET /api/evaluations/criteres — grille de critères configurée pour l'entité courante.
router.get('/criteres', async (req, res, next) => {
  try {
    const criteres = await evaluationEngine.listerCriteres(req.entite);
    res.json(criteres);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/evaluations/a-faire — rendez-vous de test assignés au formateur connecté, pas encore
// évalués. formateurId vient toujours de la session (req.utilisateur.id), jamais d'un paramètre
// de requête — un formateur ne voit que ses propres évaluations à faire (l'admin verrait une
// liste vide ici, ce rôle n'étant assigné à aucun rendez-vous ; il agit via un autre canal si
// besoin, pas prévu par cet écran).
router.get('/a-faire', async (req, res, next) => {
  try {
    const rendezvous = await evaluationEngine.listerRendezvousAEvaluer(req.entite, req.utilisateur.id);
    res.json(rendezvous);
  } catch (erreur) {
    next(erreur);
  }
});

// POST /api/evaluations — enregistre une évaluation complète pour un rendez-vous de test.
router.post('/', async (req, res, next) => {
  try {
    const { rendezvousId, resultatGlobal, orientation, commentaire, criteres } = evaluationBodySchema.parse(req.body);

    const resultat = await evaluationEngine.enregistrerEvaluation(req.entite, {
      rendezvousId,
      formateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
      resultatGlobal,
      orientation,
      commentaire,
      criteres,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: `evaluation_${resultatGlobal}`,
      tableCible: 'evaluations',
      cibleId: resultat.evaluationId,
      donnees: { rendezvousId, resultatGlobal, orientation },
      adresseIp: req.ip,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
