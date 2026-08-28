const cron = require('node-cron');
const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerSyncCalendrierManuel } = require('../core/rendezvous/syncCalendrierManuelService');

// Automatise la détection des modifications manuelles Outlook (décision utilisateur, 2026-08-28 —
// voir syncCalendrierManuelService.js) : sans déclenchement récurrent, un rendez-vous déplacé ou
// annulé directement dans Outlook resterait affiché "Prévu" à l'ancien horaire dans l'app
// indéfiniment, jusqu'à ce qu'un agent s'en aperçoive par hasard en ouvrant le calendrier. 2 fois
// par jour (8h00 et 13h00, voir demarrerCronSyncCalendrierManuel ci-dessous — décision utilisateur,
// remplace la fréquence initiale de 15 minutes), pour TOUTES les entités actives — même patron
// générique que jobs/basculeTestNonRealiseCron.js (voir Modularité CLAUDE.md : ce module ne connaît
// aucun code d'entité en dur), fréquence désormais différente des deux jobs.
//
// Verrou en mémoire — même limite assumée que basculeTestNonRealiseCron.js : empêche deux
// déclenchements planifiés de se chevaucher, pas conçu pour plusieurs instances du serveur en
// parallèle.
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log('Synchronisation calendrier manuelle (cron) : exécution précédente encore en cours, ce déclenchement est ignoré.');
    return;
  }
  executionEnCours = true;

  try {
    const bd = await obtenirKnex();
    const entites = await bd('entites').where({ actif: true });

    for (const entite of entites) {
      try {
        const resultat = await executerSyncCalendrierManuel(entite);
        console.log(
          `Synchronisation calendrier manuelle (${entite.code}) : ${resultat.annules} annulé(s), ` +
            `${resultat.deplaces} déplacé(s), ${resultat.inchanges} inchangé(s), ${resultat.ignores} ignoré(s), ` +
            `${resultat.echecs} échec(s), sur ${resultat.total} rendez-vous vérifié(s).`,
        );

        // Trace du PASSAGE du cron lui-même, en plus des lignes déjà écrites PAR rendez-vous
        // modifié (voir syncCalendrierManuelService.js, actions 'rendezvous_annule_sync_outlook'/
        // 'rendezvous_deplace_sync_outlook') — sert à confirmer que le cron tourne bien, même sur
        // un run sans aucune modification détectée.
        const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
        if (utilisateurSysteme) {
          await journalAudit.enregistrerAction(bd, {
            utilisateurId: utilisateurSysteme.id,
            entiteId: entite.id,
            action: 'cron_sync_calendrier_manuel',
            tableCible: 'rendezvous',
            donnees: resultat,
          });
        }
      } catch (erreur) {
        // Une entité en échec (ex. utilisateur système manquant) ne doit jamais empêcher les
        // autres entités actives d'être traitées à ce même passage du cron.
        console.error(`Synchronisation calendrier manuelle (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

// Point d'entrée appelé une fois au démarrage du serveur (voir server.js). 2 fois par jour, 8h00
// et 13h00 (décision utilisateur, 2026-08-28 — remplace la fréquence initiale de 15 minutes,
// jugée inutilement élevée pour une simple détection de dérive) : timezone explicite ('Europe/
// Paris', jamais le fuseau par défaut du serveur/runtime d'hébergement) pour que ces deux horaires
// restent 8h00/13h00 heure de Paris quel que soit le fuseau système du serveur — même souci
// explicite que .github/workflows/sauvegarde-neon.yml pour son propre horaire UTC. Le job des
// rappels de créneau (jobs/rappelCron.js) est volontairement placé à 13h30, APRÈS ce second passage
// (décision utilisateur) : les rappels lisent rendezvous/dossiers déjà à jour avec l'état Outlook
// réel de la journée, pas une éventuelle replanification manuelle encore non détectée.
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
  console.log('Cron "Synchronisation calendrier manuelle" démarré (2 fois par jour, 8h00 et 13h00 heure de Paris).');
}

module.exports = { demarrerCronSyncCalendrierManuel, executerPourToutesLesEntitesActives };
