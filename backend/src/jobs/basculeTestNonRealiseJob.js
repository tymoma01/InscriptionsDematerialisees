const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerBasculeTestNonRealise } = require('../core/rendezvous/basculeTestNonRealiseService');

// Logique métier du job "bascule automatique Test non réalisé" (CLAUDE.md, étape 8 du parcours),
// séparée de son déclenchement — voir basculeTestNonRealiseCron.js pour le wrapper node-cron
// utilisé en dev local, et ../../scripts/executerBasculeTestNonRealiseToutesEntites.js pour le
// point d'entrée prod invoqué par un Azure Container Apps Job. Décision utilisateur, 2026-08-31 :
// node-cron in-process abandonné en prod (voir rappelJob.js pour le détail du raisonnement — même
// souci de fiabilité sur un hébergement Container Apps qui scale-to-zero/scale-out).
//
// Idempotent (voir basculeTestNonRealiseService.js), donc rejouable sans risque de double
// transition. Générique (voir Modularité CLAUDE.md) : une entité sans statut "test_planifie" dans
// sa configuration (ex. Adaptel) obtient simplement 0 rendez-vous éligible, sans cas particulier.
//
// Verrou en mémoire — protège uniquement contre un chevauchement à l'intérieur d'un même process
// (utile pour le wrapper node-cron en dev) ; sans effet entre deux exécutions distinctes d'un
// Container Apps Job, qui démarrent chacune dans un container neuf.
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log(
      'Bascule automatique "Test non réalisé" : exécution précédente encore en cours, ce déclenchement est ignoré.',
    );
    return;
  }
  executionEnCours = true;

  try {
    const bd = await obtenirKnex();
    const entites = await bd('entites').where({ actif: true });

    for (const entite of entites) {
      try {
        const resultat = await executerBasculeTestNonRealise(entite);
        console.log(
          `Bascule automatique "Test non réalisé" (${entite.code}) : ${resultat.bascules} basculé(s), ` +
            `${resultat.ignores} ignoré(s), ${resultat.echecs} échec(s), sur ${resultat.total} rendez-vous éligible(s).`,
        );

        // Trace du PASSAGE du job lui-même, en plus des lignes déjà écrites PAR dossier basculé
        // (voir basculeTestNonRealiseService.js, action 'dossier_transition_test_non_realise_automatique')
        // — sert à confirmer que le job tourne bien, même sur un run à 0 bascule (resultat.total
        // === 0), sans avoir à chercher son absence dans les logs.
        const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
        if (utilisateurSysteme) {
          await journalAudit.enregistrerAction(bd, {
            utilisateurId: utilisateurSysteme.id,
            entiteId: entite.id,
            action: 'cron_bascule_test_non_realise',
            tableCible: 'dossiers',
            donnees: resultat,
          });
        }
      } catch (erreur) {
        // Une entité en échec (ex. utilisateur système manquant) ne doit jamais empêcher les
        // autres entités actives d'être traitées à ce même passage.
        console.error(`Bascule automatique "Test non réalisé" (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

module.exports = { executerPourToutesLesEntitesActives };
