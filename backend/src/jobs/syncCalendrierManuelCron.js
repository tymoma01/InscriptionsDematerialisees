const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./syncCalendrierManuelJob');

// Wrapper node-cron pour le confort en dev local uniquement (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES) — la logique métier vit dans syncCalendrierManuelJob.js.
// En prod, ce fichier n'est jamais chargé : le déclenchement se fait via un Azure Container Apps
// Job (trigger Schedule) qui invoque directement
// scripts/executerSyncCalendrierManuelToutesEntites.js. Décision utilisateur, 2026-08-31 (voir
// rappelJob.js pour le détail du raisonnement).
//
// 2 fois par jour, 8h00 et 13h00 : timezone explicite ('Europe/Paris', jamais le fuseau par défaut
// du serveur/runtime) pour que ces deux horaires restent 8h00/13h00 heure de Paris quel que soit
// le fuseau système. Le job des rappels de créneau est volontairement placé à 13h30, APRÈS ce
// second passage : les rappels lisent rendezvous/dossiers déjà à jour avec l'état Outlook réel de
// la journée, pas une éventuelle replanification manuelle encore non détectée.
function demarrerCronSyncCalendrierManuel() {
  cron.schedule(
    '0 8,13 * * *',
    () => {
      executerPourToutesLesEntitesActives().catch((erreur) => {
        console.error('Synchronisation calendrier manuelle (cron) : échec inattendu ✘', erreur);
      });
    },
    { timezone: 'Europe/Paris' },
  );
  console.log(
    'Cron "Synchronisation calendrier manuelle" démarré (2 fois par jour, 8h00 et 13h00 heure de Paris) — dev local uniquement.',
  );
}

module.exports = { demarrerCronSyncCalendrierManuel };
