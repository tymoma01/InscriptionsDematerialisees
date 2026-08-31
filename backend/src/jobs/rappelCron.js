const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./rappelJob');

// Wrapper node-cron pour le confort en dev local uniquement (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES) — la logique métier vit dans rappelJob.js. En prod, ce
// fichier n'est jamais chargé : le déclenchement se fait via un Azure Container Apps Job (trigger
// Schedule) qui invoque directement scripts/executerRappelsToutesEntites.js. Décision utilisateur,
// 2026-08-31 (voir rappelJob.js pour le détail du raisonnement).
function demarrerCronRappel() {
  cron.schedule(
    '30 13 * * *',
    () => {
      executerPourToutesLesEntitesActives().catch((erreur) => {
        console.error('Rappel automatique de créneau (cron) : échec inattendu ✘', erreur);
      });
    },
    { timezone: 'Europe/Paris' },
  );
  console.log('Cron "Rappel automatique de créneau" démarré (1 fois par jour, 13h30 heure de Paris) — dev local uniquement.');
}

module.exports = { demarrerCronRappel };
