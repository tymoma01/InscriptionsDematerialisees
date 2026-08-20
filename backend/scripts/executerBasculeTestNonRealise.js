// Déclenche la bascule automatique "Test non réalisé" pour une entité (CLAUDE.md, étape 8 du
// parcours : rendez-vous de test dont la date est passée sans qu'aucun agent n'ait agi dessus) —
// idempotent (voir core/rendezvous/basculeTestNonRealiseService.js), donc rejouable sans risque de
// double transition.
//
// Mécanisme de déclenchement en production non tranché à ce stade (cron externe sur le serveur,
// tâche planifiée, Azure Function Timer...) — même situation que scripts/executerRappels.js : ce
// script est le point d'entrée que ce mécanisme, quel qu'il soit, doit invoquer périodiquement
// (ex. toutes les heures). En local, peut être lancé manuellement ou via une tâche cron classique
// (ex. `0 * * * * cd .../backend && node scripts/executerBasculeTestNonRealise.js accecit`).
//
// Usage : node scripts/executerBasculeTestNonRealise.js <code_entite>

const { obtenirKnex } = require('../src/db/knex');
const { executerBasculeTestNonRealise } = require('../src/core/rendezvous/basculeTestNonRealiseService');

async function main(codeEntite) {
  const bd = await obtenirKnex();
  try {
    const entite = await bd('entites').where({ code: codeEntite, actif: true }).first();
    if (!entite) {
      throw new Error(`Entité « ${codeEntite} » introuvable ou inactive.`);
    }

    const resultat = await executerBasculeTestNonRealise(entite);
    console.log(
      `Bascule automatique « ${codeEntite} » : ${resultat.bascules} basculé(s), ${resultat.ignores} ignoré(s) (déjà traité manuellement), ${resultat.echecs} échec(s), sur ${resultat.total} rendez-vous éligible(s).`,
    );
  } finally {
    await bd.destroy();
  }
}

const codeEntite = process.argv[2];
if (!codeEntite) {
  console.error('Usage : node scripts/executerBasculeTestNonRealise.js <code_entite>');
  process.exit(1);
}

main(codeEntite).catch((erreur) => {
  console.error('Échec de l’exécution de la bascule automatique ✘');
  console.error(erreur.message);
  process.exit(1);
});
