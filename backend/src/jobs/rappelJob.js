const { obtenirKnex } = require('../db/knex');
const { executerRappels } = require('../core/rendezvous/rappelService');

// Logique métier du job "rappel automatique de créneau" (CLAUDE.md, besoin Accueil/Coordination :
// "confirmation de présence à un créneau avant le jour J (rappel automatique), pour réduire les
// désistements"), séparée de son déclenchement — voir rappelCron.js pour le wrapper node-cron,
// chargé en dev ET en prod (voir server.js). Décision utilisateur, 2026-09-07 : revient sur le
// choix du 2026-08-31 (Azure Container Apps Jobs externes, un par job) — motif coût, ces 3
// ressources Azure séparées consommaient (même marginalement) indépendamment de l'activité réelle
// de l'app ; `inscriptions-backend` ayant par ailleurs déjà une fenêtre de disponibilité garantie
// 8h-20h Paris (règle de scale Azure "horaires-bureau") qui couvre les 3 horaires de rappel
// (9h/13h30/17h), le cron in-process retrouve une fiabilité suffisante sans avoir à payer une
// disponibilité 24/7 de l'app. Ce module reste néanmoins indépendant de node-cron (aucun import
// ici) : rien n'empêche de le redéclencher un jour depuis un autre mécanisme si besoin.
//
// Idempotent (voir rappelService.executerRappels, rendezvousRepository.listerRendezvousARappeler
// exclut déjà les rendez-vous ayant reçu un rappel) : rejouable sans risque de double envoi.
//
// Verrou en mémoire — redevient pleinement utile avec le cron in-process (un seul process
// long-vivant, contrairement à un Container Apps Job qui démarrait un container neuf à chaque
// exécution) : protège contre un chevauchement si une exécution précédente traînait encore en
// cours au déclenchement suivant.
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
