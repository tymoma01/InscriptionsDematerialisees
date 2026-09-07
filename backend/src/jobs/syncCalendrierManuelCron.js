const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./syncCalendrierManuelJob');

// Wrapper node-cron, chargé en dev ET en prod (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES — revirement du 2026-09-07 sur la décision du 2026-08-31,
// motif coût) — la logique métier vit dans syncCalendrierManuelJob.js.
//
// Toutes les heures (décision utilisateur, 2026-09-03 — remplace les deux passages fixes
// 8h00/13h00 initiaux), timezone explicite ('Europe/Paris', jamais le fuseau par défaut du
// serveur/runtime) pour que "toutes les heures" reste vrai heure de Paris quel que soit le fuseau
// système — option native node-cron, plus besoin du contournement fenetreHoraireParis.js utilisé
// un temps par les Azure Container Apps Jobs (trigger Schedule figé en UTC), fichier et scripts
// associés retirés (voir leur historique git).
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
  console.log('Cron "Synchronisation calendrier manuelle" démarré (toutes les heures).');
}

module.exports = { demarrerCronSyncCalendrierManuel };
