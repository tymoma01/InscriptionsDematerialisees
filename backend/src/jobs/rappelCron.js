const cron = require('node-cron');
const { executerPourToutesLesEntitesActives } = require('./rappelJob');

// Wrapper node-cron pour le confort en dev local uniquement (voir server.js et
// config/env.js#ACTIVER_CRONS_INTERNES) — la logique métier vit dans rappelJob.js. En prod, ce
// fichier n'est jamais chargé : le déclenchement se fait via un Azure Container Apps Job (trigger
// Schedule) qui invoque directement scripts/executerRappelsToutesEntites.js. Décision utilisateur,
// 2026-08-31 (voir rappelJob.js pour le détail du raisonnement).
// 3 fois par jour (décision utilisateur, 2026-09-03 — remplace l'unique passage à 13h30 initial) :
// une expression cron unique du type '0,30 9,13,17 * * *' déclencherait aussi 9h30/13h00/17h30
// (produit cartésien des deux listes), d'où trois cron.schedule() distincts plutôt qu'une seule
// expression. Aligné sur executerRappelsToutesEntites.js (prod) pour un comportement cohérent
// entre dev local et prod.
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
  console.log('Cron "Rappel automatique de créneau" démarré (3 fois par jour : 9h00/13h30/17h00 heure de Paris) — dev local uniquement.');
}

module.exports = { demarrerCronRappel };
