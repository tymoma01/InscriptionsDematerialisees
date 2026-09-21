const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./rattrapageAnnulationTestJob');

// Wrapper node-cron, chargé en dev ET en prod (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES) — même patron que basculeTestNonRealiseCron.js, la
// logique métier vit dans rattrapageAnnulationTestJob.js.
//
// '0 * * * *' : toutes les heures — même fréquence et même raisonnement que
// basculeTestNonRealiseCron.js (filet de sécurité, doit agir dès qu'un dossier est détecté
// incohérent, à n'importe quelle heure ; pas de fenêtre horaire Paris ici, contrairement à
// rappelCron.js/syncCalendrierManuelCron.js).
function demarrerCronRattrapageAnnulationTest() {
  cron.schedule('0 * * * *', () => {
    executerPourToutesLesEntitesActives().catch((erreur) => {
      console.error('Filet de sécurité "Rattrapage annulation test" (cron) : échec inattendu ✘', erreur);
    });
  });
  console.log('Cron "Filet de sécurité — Rattrapage annulation test" démarré (toutes les heures).');
}

module.exports = { demarrerCronRattrapageAnnulationTest };
