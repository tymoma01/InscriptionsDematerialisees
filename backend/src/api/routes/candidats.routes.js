const { Router } = require('express');
const { z } = require('zod');
const { inscrireCandidat, ErreurInscriptionConflit } = require('../../core/dossier/dossierService');

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

module.exports = router;
