const { Router } = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');
const { obtenirKnex } = require('../../db/knex');
const pieceJustificativeRepository = require('../../core/dossier/pieceJustificativeRepository');

const router = Router();

// GET /api/types-pieces — liste des pièces justificatives de l'entité (table types_pieces), lue
// par l'écran de capture et par le calcul « pièces obligatoires complètes ». Simple
// configuration, aucune donnée candidat : réservée aux utilisateurs connectés, sans autre droit.
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const bd = await obtenirKnex();
    const types = await pieceJustificativeRepository.listerTypesPiecesAffiches(bd, req.entite.id);
    res.json({
      typesPieces: types.map((type) => ({
        code: type.code,
        libelle: type.libelle,
        obligatoire: type.obligatoire,
        captureUniquement: type.capture_uniquement,
        multiple: type.multiple,
        codeVerso: type.code_verso ?? undefined,
      })),
    });
  } catch (erreur) {
    next(erreur);
  }
});

module.exports = router;
