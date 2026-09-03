const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./syncCalendrierManuelJob');

// Wrapper node-cron pour le confort en dev local uniquement (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES) — la logique métier vit dans syncCalendrierManuelJob.js.
// En prod, ce fichier n'est jamais chargé : le déclenchement se fait via un Azure Container Apps
// Job (trigger Schedule) qui invoque directement
// scripts/executerSyncCalendrierManuelToutesEntites.js. Décision utilisateur, 2026-08-31 (voir
// rappelJob.js pour le détail du raisonnement).
//
// Toutes les heures (décision utilisateur, 2026-09-03 — remplace les deux passages fixes
// 8h00/13h00 initiaux), timezone explicite ('Europe/Paris', jamais le fuseau par défaut du
// serveur/runtime) pour que "toutes les heures" reste vrai heure de Paris quel que soit le fuseau
// système. Aligné sur executerSyncCalendrierManuelToutesEntites.js (prod) pour un comportement
// cohérent entre dev local et prod.
function demarrerCronSyncCalendrierManuel() {
  cron.schedule(
    '0 * * * *',
    () => {
      executerPourToutesLesEntitesActives().catch((erreur) => {
        console.error('Synchronisation calendrier manuelle (cron) : échec inattendu ✘', erreur);
      });
    },
    { timezone: 'Europe/Paris' },
  );
  console.log('Cron "Synchronisation calendrier manuelle" démarré (toutes les heures) — dev local uniquement.');
}

module.exports = { demarrerCronSyncCalendrierManuel };
