const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./basculeTestNonRealiseJob');

// Wrapper node-cron pour le confort en dev local uniquement (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES) — la logique métier vit dans basculeTestNonRealiseJob.js.
// En prod, ce fichier n'est jamais chargé : le déclenchement se fait via un Azure Container Apps
// Job (trigger Schedule) qui invoque directement
// scripts/executerBasculeTestNonRealiseToutesEntites.js. Décision utilisateur, 2026-08-31 (voir
// rappelJob.js pour le détail du raisonnement).
//
// '*/15 * * * *' : toutes les 15 minutes, même fréquence pour toutes les entités (pas de
// configuration par entité pour l'instant, hors périmètre de cette demande).
function demarrerCronBasculeTestNonRealise() {
  cron.schedule('*/15 * * * *', () => {
    executerPourToutesLesEntitesActives().catch((erreur) => {
      console.error('Bascule automatique "Test non réalisé" (cron) : échec inattendu ✘', erreur);
    });
  });
  console.log('Cron "Bascule automatique Test non réalisé" démarré (toutes les 15 minutes) — dev local uniquement.');
}

module.exports = { demarrerCronBasculeTestNonRealise };
