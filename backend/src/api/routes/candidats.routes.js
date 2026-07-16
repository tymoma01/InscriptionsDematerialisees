const { Router } = require('express');
const { z } = require('zod');
const { inscrireCandidat } = require('../../core/dossier/dossierService');

const router = Router();

// POST /api/candidats — inscription d'un candidat à l'accueil (tablette). Aucune
// authentification requise : c'est le candidat lui-même qui saisit ses données, avant la
// vérification des pièces justificatives par l'accueil (étape suivante du parcours).
router.post('/', async (req, res, next) => {
  try {
    const { candidatId, dossierId } = await inscrireCandidat(req.entite, req.body);
    res.status(201).json({ candidatId, dossierId });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

module.exports = router;
