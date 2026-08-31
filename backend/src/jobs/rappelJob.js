const { obtenirKnex } = require('../db/knex');
const { executerRappels } = require('../core/rendezvous/rappelService');

// Logique métier du job "rappel automatique de créneau" (CLAUDE.md, besoin Accueil/Coordination :
// "confirmation de présence à un créneau avant le jour J (rappel automatique), pour réduire les
// désistements"), séparée de son déclenchement — voir rappelCron.js pour le wrapper node-cron
// utilisé en dev local, et ../../scripts/executerRappelsToutesEntites.js pour le point d'entrée
// prod invoqué par un Azure Container Apps Job. Décision utilisateur, 2026-08-31 : node-cron
// in-process abandonné en prod — l'hébergement cible (Container Apps, plan Consumption) scale-to-
// zero et scale-out, ce qui rend un cron in-process avec verrou en mémoire non fiable (job qui ne
// se déclenche jamais si 0 replica, ou déclenchements en double si plusieurs replicas). Ce module
// ne dépend donc plus de node-cron, pour rester appelable depuis n'importe quel déclencheur externe.
//
// Idempotent (voir rappelService.executerRappels, rendezvousRepository.listerRendezvousARappeler
// exclut déjà les rendez-vous ayant reçu un rappel) : rejouable sans risque de double envoi.
//
// Verrou en mémoire — protège uniquement contre un chevauchement à l'intérieur d'un même process
// (utile pour le wrapper node-cron en dev) ; sans effet entre deux exécutions distinctes d'un
// Container Apps Job, qui démarrent chacune dans un container neuf — pas un problème ici puisque
// chaque exécution du Job tourne jusqu'à son terme avant que la suivante ne soit déclenchée.
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log('Rappel automatique de créneau : exécution précédente encore en cours, ce déclenchement est ignoré.');
    return;
  }
  executionEnCours = true;

  try {
    const bd = await obtenirKnex();
    const entites = await bd('entites').where({ actif: true });

    for (const entite of entites) {
      try {
        const resultat = await executerRappels(entite);
        if (resultat.desactive) {
          console.log(`Rappel automatique de créneau (${entite.code}) : non exécuté, sms_actif désactivé pour cette entité.`);
          continue;
        }
        console.log(
          `Rappel automatique de créneau (${entite.code}) : ${resultat.envoyes} envoyé(s), ` +
            `${resultat.ignores} ignoré(s), ${resultat.echecs} échec(s), sur ${resultat.total} rendez-vous éligible(s).`,
        );
      } catch (erreur) {
        // Une entité en échec (ex. canal_rappel mal configuré, utilisateur système manquant) ne
        // doit jamais empêcher les autres entités actives d'être traitées à ce même passage.
        console.error(`Rappel automatique de créneau (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

module.exports = { executerPourToutesLesEntitesActives };
