const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerSyncCalendrierManuel } = require('../core/rendezvous/syncCalendrierManuelService');

// Logique métier du job "synchronisation calendrier manuelle" (détecte les modifications faites
// directement dans Outlook — voir syncCalendrierManuelService.js), séparée de son déclenchement —
// voir syncCalendrierManuelCron.js pour le wrapper node-cron, chargé en dev ET en prod (voir
// server.js). Décision utilisateur, 2026-09-07 : revient sur le choix du 2026-08-31 (Azure
// Container Apps Jobs externes) — motif coût, voir rappelJob.js pour le détail du raisonnement.
//
// Verrou en mémoire — redevient pleinement utile avec le cron in-process (voir rappelJob.js) :
// protège contre un chevauchement si une exécution précédente traînait encore en cours.
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log('Synchronisation calendrier manuelle : exécution précédente encore en cours, ce déclenchement est ignoré.');
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

        // Trace du PASSAGE du job lui-même, en plus des lignes déjà écrites PAR rendez-vous
        // modifié (voir syncCalendrierManuelService.js, actions 'rendezvous_annule_sync_outlook'/
        // 'rendezvous_deplace_sync_outlook') — sert à confirmer que le job tourne bien, même sur
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
        // autres entités actives d'être traitées à ce même passage.
        console.error(`Synchronisation calendrier manuelle (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

module.exports = { executerPourToutesLesEntitesActives };
