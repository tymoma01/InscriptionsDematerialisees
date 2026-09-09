const db = require('../../db/knex');
const formulaireRepository = require('./formulaireRepository');

// Configuration du formulaire d'inscription résolue pour l'entité courante (voir entiteContext) —
// remplace l'ancien import statique côté front (formulaireConfig.accecit.js) : c'est CETTE
// résolution par entité qui permet à une autre entité (ex. Adaptel, voir CLAUDE.md, Modularité)
// d'avoir ses propres blocs actifs/ordre sans toucher au code. `largeur` omise (plutôt que `null`)
// pour un bloc sans mise en page particulière : même sémantique que l'ancien fichier statique,
// où l'absence de la clé signifiait "pleine largeur" (voir useFormulaireInscription.js /
// BlocRenderer.jsx côté front).
async function obtenirConfigurationFormulaire(entite) {
  const bd = await db.obtenirKnex();
  const blocs = await formulaireRepository.listerBlocsFormulaire(bd, entite.id);
  return blocs.map(({ code, libelle, actif, etape, ordre, largeur, config }) => ({
    code,
    libelle,
    actif,
    etape,
    ordre,
    largeur: largeur ?? undefined,
    config,
  }));
}

module.exports = { obtenirConfigurationFormulaire };
