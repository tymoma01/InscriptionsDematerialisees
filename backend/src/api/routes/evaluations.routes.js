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

// posteCode volontairement libre ici (pas un enum figé) : les postes viennent de la config du
// formulaire d'inscription (BlocDisponibilites.jsx), propre à chaque entité — un code qui ne
// correspond à aucun poste déclaré pour ce dossier est rejeté par evaluationEngine (résolution
// serveur), pas ici (voir Modularité, CLAUDE.md).
const posteCodeSchema = z.string().trim().min(1).optional();

const evaluationBodySchema = z.object({
  rendezvousId: idPositifSchema,
  resultatGlobal: z.enum(['valide', 'invalide']),
  // Sans objet si resultatGlobal vaut 'invalide' — la présence/validité pour un verdict positif
  // est revérifiée par evaluationEngine, pas ici (voir Modularité, CLAUDE.md : ce schéma ne fait
  // que la forme, jamais la règle métier).
  orientation: z.enum(['envoi_formation', 'pret_embauche']).optional(),
  posteCode: posteCodeSchema,
  commentaire: z.string().trim().min(1),
  // Les codes de question/item ne sont volontairement pas figés ici : ils viennent du
  // questionnaire résolu pour le poste (voir questionnaires_evaluation/questions_evaluation,
  // migration 037), configurable par entité — un code inconnu ou une grille incomplète est
  // rejetée par evaluationEngine, pas ici (voir Modularité, CLAUDE.md).
  reponses: z
    .array(
      z.object({
        questionCode: z.string().trim().min(1),
        questionItemCode: z.string().trim().min(1).optional(),
        valeur: z.string().trim().min(0),
      }),
    )
    .min(1),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// GET /api/evaluations/questionnaire — questions+items du questionnaire résolu pour le poste
// donné (repli générique si absent, voir evaluationEngine.listerQuestionnaire). rendezvousId
// obligatoire : sert à vérifier que ce formateur a bien accès à ce rendez-vous et que le
// posteCode demandé correspond réellement au dossier concerné, pas un paramètre libre.
router.get('/questionnaire', async (req, res, next) => {
  try {
    const { rendezvousId, posteCode } = z
      .object({ rendezvousId: idPositifSchema, posteCode: posteCodeSchema })
      .parse(req.query);

    const questions = await evaluationEngine.listerQuestionnaire(req.entite, {
      rendezvousId,
      formateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
      posteCode,
    });
    res.json(questions);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
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

// GET /api/evaluations/historique — évaluations déjà soumises par le formateur connecté
// (jamais tous formateurs confondus, voir evaluationEngine.listerHistorique). formateurId vient
// toujours de la session, même principe que /a-faire ci-dessus.
router.get('/historique', async (req, res, next) => {
  try {
    const historique = await evaluationEngine.listerHistorique(req.entite, req.utilisateur.id);
    res.json(historique);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/evaluations/historique/:id — détail en lecture seule d'une évaluation déjà soumise
// (voir DetailEvaluation.jsx) ; l'appartenance au formateur connecté est revérifiée côté serveur
// (evaluationEngine.obtenirDetailEvaluation), jamais de confiance dans le fait que l'id apparaît
// dans SA propre liste côté front.
router.get('/historique/:id', async (req, res, next) => {
  try {
    const { id: evaluationId } = z.object({ id: idPositifSchema }).parse(req.params);
    const detail = await evaluationEngine.obtenirDetailEvaluation(req.entite, {
      evaluationId,
      formateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
    });
    res.json(detail);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// POST /api/evaluations — enregistre une évaluation complète pour un rendez-vous de test.
router.post('/', async (req, res, next) => {
  try {
    const { rendezvousId, resultatGlobal, orientation, posteCode, commentaire, reponses } = evaluationBodySchema.parse(
      req.body,
    );

    const resultat = await evaluationEngine.enregistrerEvaluation(req.entite, {
      rendezvousId,
      formateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
      resultatGlobal,
      orientation,
      posteCode,
      commentaire,
      reponses,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: `evaluation_${resultatGlobal}`,
      tableCible: 'evaluations',
      cibleId: resultat.evaluationId,
      donnees: { rendezvousId, resultatGlobal, orientation, posteCode },
      adresseIp: req.ip,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
