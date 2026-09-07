const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./rappelJob');

// Wrapper node-cron, chargé en dev ET en prod (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES — revirement du 2026-09-07 sur la décision du 2026-08-31,
// motif coût) — la logique métier vit dans rappelJob.js.
// 3 fois par jour (décision utilisateur, 2026-09-03 — remplace l'unique passage à 13h30 initial) :
// une expression cron unique du type '0,30 9,13,17 * * *' déclencherait aussi 9h30/13h00/17h30
// (produit cartésien des deux listes), d'où trois cron.schedule() distincts plutôt qu'une seule
// expression. `timezone: 'Europe/Paris'` (option native node-cron) : plus besoin du contournement
// fenetreHoraireParis.js utilisé un temps par les Azure Container Apps Jobs (trigger Schedule
// figé en UTC, sans fuseau horaire) — node-cron sait nativement rester correct à travers les
// changements d'heure été/hiver, fichier et scripts associés retirés (voir leur historique git).
function demarrerCronRappel() {
  const HORAIRES = ['0 9 * * *', '30 13 * * *', '0 17 * * *'];

  HORAIRES.forEach((expressionCron) => {
    cron.schedule(
      expressionCron,
      () => {
        executerPourToutesLesEntitesActives().catch((erreur) => {
          console.error('Rappel automatique de créneau (cron) : échec inattendu ✘', erreur);
        });
      },
      { timezone: 'Europe/Paris' },
    );
  });
  console.log('Cron "Rappel automatique de créneau" démarré (3 fois par jour : 9h00/13h30/17h00 heure de Paris).');
}

module.exports = { demarrerCronRappel };
