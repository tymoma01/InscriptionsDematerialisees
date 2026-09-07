const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerBasculeTestNonRealise } = require('../core/rendezvous/basculeTestNonRealiseService');

// Logique métier du job "bascule automatique Test non réalisé" (CLAUDE.md, étape 8 du parcours),
// séparée de son déclenchement — voir basculeTestNonRealiseCron.js pour le wrapper node-cron,
// chargé en dev ET en prod (voir server.js). Décision utilisateur, 2026-09-07 : revient sur le
// choix du 2026-08-31 (Azure Container Apps Jobs externes) — motif coût, voir rappelJob.js pour le
// détail du raisonnement (fenêtre de disponibilité 8h-20h Paris déjà garantie par une règle de
// scale Azure, suffisante pour ce job horaire).
//
// Idempotent (voir basculeTestNonRealiseService.js), donc rejouable sans risque de double
// transition. Générique (voir Modularité CLAUDE.md) : une entité sans statut "test_planifie" dans
// sa configuration (ex. Adaptel) obtient simplement 0 rendez-vous éligible, sans cas particulier.
//
// Verrou en mémoire — redevient pleinement utile avec le cron in-process (voir rappelJob.js) :
// protège contre un chevauchement si une exécution précédente traînait encore en cours.
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
