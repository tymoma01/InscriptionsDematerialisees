const { Router } = require('express');
const { z } = require('zod');
const { inscrireCandidat, verifierDisponibilite, ErreurInscriptionConflit } = require('../../core/dossier/dossierService');
const { limiteurVerificationDisponibilite } = require('../middlewares/rateLimiter');

const router = Router();

// POST /api/candidats — inscription d'un candidat à l'accueil (tablette). Aucune
// authentification requise : c'est le candidat lui-même qui saisit ses données, avant la
// vérification des pièces justificatives par l'accueil (étape suivante du parcours).
router.post('/', async (req, res, next) => {
  try {
    const { candidatId, dossierId } = await inscrireCandidat(req.entite, req.body);
    console.log(`Inscription réussie : candidat ${candidatId}, dossier ${dossierId} (entité ${req.entite.code}).`);
    res.status(201).json({ candidatId, dossierId });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      console.warn('Inscription rejetée (données invalides) :', JSON.stringify(erreur.flatten()));
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    // NIR ou email déjà utilisé par un autre dossier de cette entité — donnée valide mais en
    // conflit, distinct d'une erreur de validation (400) ou d'une erreur serveur générique (500).
    if (erreur instanceof ErreurInscriptionConflit) {
      console.warn(`Inscription rejetée (conflit ${erreur.champ}), entité ${req.entite.code}.`);
      return res.status(409).json({ erreur: erreur.message, champ: erreur.champ });
    }
    next(erreur);
  }
});

const disponibiliteSchema = z.object({
  champ: z.enum(['nir', 'email']),
  valeur: z.string().trim().min(1),
});

// POST /api/candidats/disponibilite — vérification ponctuelle d'unicité (NIR ou email), appelée
// au blur du champ concerné avant la soumission finale (voir BlocInfosPerso.jsx/
// BlocCoordonnees.jsx côté front). Ne renvoie qu'un booléen, jamais l'identité du dossier en
// conflit. En POST plutôt qu'en GET : une valeur (potentiellement un NIR) en query string finirait
// en clair dans les logs d'accès (voir le middleware de log dans app.js, qui journalise
// req.originalUrl).
router.post('/disponibilite', limiteurVerificationDisponibilite, async (req, res, next) => {
  try {
    const { champ, valeur } = disponibiliteSchema.parse(req.body);
    const disponible = await verifierDisponibilite(req.entite, champ, valeur);
    res.json({ disponible });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Requête invalide.' });
    }
    next(erreur);
  }
});

module.exports = router;
