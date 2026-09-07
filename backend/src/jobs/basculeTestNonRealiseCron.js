const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./basculeTestNonRealiseJob');

// Wrapper node-cron, chargé en dev ET en prod (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES — revirement du 2026-09-07 sur la décision du 2026-08-31,
// motif coût) — la logique métier vit dans basculeTestNonRealiseJob.js.
//
// '0 * * * *' : toutes les heures (décision utilisateur, 2026-09-03 — remplace les 15 minutes
// initiales), même fréquence pour toutes les entités (pas de configuration par entité pour
// l'instant, hors périmètre de cette demande). Pas de fenêtre horaire Paris ici (contrairement à
// rappelCron.js/syncCalendrierManuelCron.js) : ce job doit agir dès qu'un rendez-vous de test est
// éligible, à n'importe quelle heure de la journée — sans objet de toute façon pour un cron
// in-process (contrairement à l'ancien trigger Schedule Azure en UTC, node-cron tourne déjà à
// l'heure système, jamais en dérive de fuseau).
function demarrerCronBasculeTestNonRealise() {
  cron.schedule('0 * * * *', () => {
    executerPourToutesLesEntitesActives().catch((erreur) => {
      console.error('Bascule automatique "Test non réalisé" (cron) : échec inattendu ✘', erreur);
    });
  });
  console.log('Cron "Bascule automatique Test non réalisé" démarré (toutes les heures).');
}

module.exports = { demarrerCronBasculeTestNonRealise };
