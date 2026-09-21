const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerRattrapageAnnulationTest } = require('../core/rendezvous/rattrapageAnnulationTestService');

// Logique métier du job "Filet de sécurité — rattrapage annulation test" (audit 2026-09-21), même
// patron que basculeTestNonRealiseJob.js — séparée de son déclenchement, voir
// rattrapageAnnulationTestCron.js pour le wrapper node-cron, chargé en dev ET en prod (voir
// server.js).
//
// Idempotent (voir rattrapageAnnulationTestService.js), donc rejouable sans risque de double
// transition. Générique (voir Modularité CLAUDE.md) : une entité sans statut "test_planifie" dans
// sa configuration (ex. Adaptel) obtient simplement 0 dossier candidat, sans cas particulier.
//
// Verrou en mémoire — même rôle que basculeTestNonRealiseJob.js : protège contre un chevauchement
// si une exécution précédente traînait encore en cours.
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log(
      'Filet de sécurité "Rattrapage annulation test" : exécution précédente encore en cours, ce déclenchement est ignoré.',
    );
    return;
  }
  executionEnCours = true;

  try {
    const bd = await obtenirKnex();
    const entites = await bd('entites').where({ actif: true });

    for (const entite of entites) {
      try {
        const resultat = await executerRattrapageAnnulationTest(entite);
        console.log(
          `Filet de sécurité "Rattrapage annulation test" (${entite.code}) : ${resultat.corriges} corrigé(s), ` +
            `${resultat.ignores} ignoré(s), ${resultat.echecs} échec(s), sur ${resultat.total} dossier(s) candidat(s).`,
        );

        // Trace du PASSAGE du job lui-même, en plus des lignes déjà écrites PAR dossier corrigé
        // (voir rattrapageAnnulationTestService.js, action
        // 'dossier_transition_test_non_realise_annulation_rattrapage') — même patron que
        // basculeTestNonRealiseJob.js ('cron_bascule_test_non_realise') : sert à confirmer que le
        // job tourne bien, même sur un run à 0 correction (resultat.total === 0), sans avoir à
        // chercher son absence dans les logs.
        const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
        if (utilisateurSysteme) {
          await journalAudit.enregistrerAction(bd, {
            utilisateurId: utilisateurSysteme.id,
            entiteId: entite.id,
            action: 'cron_rattrapage_annulation_test',
            tableCible: 'dossiers',
            donnees: resultat,
          });
        }
      } catch (erreur) {
        // Une entité en échec (ex. utilisateur système manquant) ne doit jamais empêcher les
        // autres entités actives d'être traitées à ce même passage.
        console.error(`Filet de sécurité "Rattrapage annulation test" (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

module.exports = { executerPourToutesLesEntitesActives };
