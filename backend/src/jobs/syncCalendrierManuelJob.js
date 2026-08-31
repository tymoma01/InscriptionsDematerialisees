const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerSyncCalendrierManuel } = require('../core/rendezvous/syncCalendrierManuelService');

// Logique métier du job "synchronisation calendrier manuelle" (détecte les modifications faites
// directement dans Outlook — voir syncCalendrierManuelService.js), séparée de son déclenchement —
// voir syncCalendrierManuelCron.js pour le wrapper node-cron utilisé en dev local, et
// ../../scripts/executerSyncCalendrierManuelToutesEntites.js pour le point d'entrée prod invoqué
// par un Azure Container Apps Job. Décision utilisateur, 2026-08-31 : node-cron in-process
// abandonné en prod (voir rappelJob.js pour le détail du raisonnement).
//
// Verrou en mémoire — protège uniquement contre un chevauchement à l'intérieur d'un même process
// (utile pour le wrapper node-cron en dev) ; sans effet entre deux exécutions distinctes d'un
// Container Apps Job, qui démarrent chacune dans un container neuf.
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
