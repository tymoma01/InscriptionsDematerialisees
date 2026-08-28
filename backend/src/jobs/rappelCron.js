const cron = require('node-cron');
const { obtenirKnex } = require('../db/knex');
const { executerRappels } = require('../core/rendezvous/rappelService');

// Automatise le rappel de créneau (CLAUDE.md, besoin Accueil/Coordination : "confirmation de
// présence à un créneau avant le jour J (rappel automatique), pour réduire les désistements") —
// jusqu'ici déclenchable uniquement à la main via scripts/executerRappels.js ("mécanisme de
// déclenchement en production non tranché à ce stade", voir son commentaire d'en-tête). Décision
// utilisateur, 2026-08-28 : 1 fois par jour à 13h30 heure de Paris, pour TOUTES les entités actives
// — même patron générique que jobs/basculeTestNonRealiseCron.js/jobs/syncCalendrierManuelCron.js
// (voir Modularité CLAUDE.md : ce module ne connaît aucun code d'entité en dur). Idempotent (voir
// rappelService.executerRappels, rendezvousRepository.listerRendezvousARappeler exclut déjà les
// rendez-vous ayant reçu un rappel) : rejouable sans risque de double envoi.
//
// 13h30, volontairement APRÈS le passage de 13h00 de jobs/syncCalendrierManuelCron.js (décision
// utilisateur explicite, "après que l'autre run ait fini") : les rappels doivent partir sur un état
// de rendez-vous déjà réconcilié avec Outlook (une éventuelle replanification/annulation manuelle
// faite dans Outlook le matin même a ainsi le temps d'être répercutée sur `rendezvous` avant que ce
// job ne décide à qui envoyer un rappel).
//
// Verrou en mémoire — même limite assumée que les deux autres crons : empêche deux déclenchements
// planifiés de se chevaucher, pas conçu pour plusieurs instances du serveur en parallèle.
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log('Rappel automatique de créneau (cron) : exécution précédente encore en cours, ce déclenchement est ignoré.');
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
        // doit jamais empêcher les autres entités actives d'être traitées à ce même passage du
        // cron — même principe que jobs/basculeTestNonRealiseCron.js/jobs/syncCalendrierManuelCron.js.
        console.error(`Rappel automatique de créneau (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

// Point d'entrée appelé une fois au démarrage du serveur (voir server.js).
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
  console.log('Cron "Rappel automatique de créneau" démarré (1 fois par jour, 13h30 heure de Paris).');
}

module.exports = { demarrerCronRappel, executerPourToutesLesEntitesActives };
