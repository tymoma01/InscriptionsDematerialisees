// Point d'entrée prod du job "bascule automatique Test non réalisé" (CLAUDE.md, étape 8 du
// parcours) — destiné à être invoqué par un Azure Container Apps Job (trigger Schedule, ex. toutes
// les 15 minutes). Décision utilisateur, 2026-08-31 : remplace l'ancien mécanisme in-process
// (node-cron dans server.js), non fiable sur un hébergement Container Apps qui scale-to-zero/
// scale-out (voir src/jobs/basculeTestNonRealiseJob.js pour le détail du raisonnement). Traite
// TOUTES les entités actives, pas une seule — contrairement à executerBasculeTestNonRealise.js,
// gardé tel quel pour un déclenchement manuel ciblé sur une entité.
//
// Pas de fenêtre horaire ici (contrairement aux rappels/sync calendrier, voir
// src/jobs/fenetreHoraireParis.js) : ce job doit agir dès qu'un rendez-vous de test est éligible,
// à n'importe quelle heure de la journée.
//
// Usage : node scripts/executerBasculeTestNonRealiseToutesEntites.js

const { obtenirKnex } = require('../src/db/knex');
const { executerPourToutesLesEntitesActives } = require('../src/jobs/basculeTestNonRealiseJob');

async function main() {
  const bd = await obtenirKnex();
  try {
    await executerPourToutesLesEntitesActives();
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec de l’exécution de la bascule automatique ✘');
  console.error(erreur.message);
  process.exit(1);
});
