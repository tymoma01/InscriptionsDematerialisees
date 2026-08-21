const cron = require('node-cron');
const { obtenirKnex } = require('../db/knex');
const dossierRepository = require('../core/dossier/dossierRepository');
const journalAudit = require('../core/audit/journalAudit');
const { executerBasculeTestNonRealise } = require('../core/rendezvous/basculeTestNonRealiseService');

// Automatise ce que scripts/executerBasculeTestNonRealise.js exigeait jusqu'ici de lancer à la
// main (voir son commentaire d'en-tête, "mécanisme de déclenchement en production non tranché à
// ce stade") — audit du 2026-08-21 (dossier #84) : sans déclenchement récurrent, un rendez-vous
// resté "prevu" après sa date pouvait rester bloqué pendant des heures, le dossier n'avançant
// jamais vers "test_non_realise" tant que personne ne relançait le script à la main. Toutes les
// 15 minutes, pour TOUTES les entités actives (générique, voir Modularité CLAUDE.md : ce module ne
// connaît aucun code d'entité en dur) — une entité sans statut "test_planifie" dans sa
// configuration (ex. Adaptel aujourd'hui) obtient simplement 0 rendez-vous éligible via
// executerBasculeTestNonRealise, sans cas particulier à gérer ici.
//
// Verrou en mémoire (process unique en dev, `node --watch`) plutôt qu'un verrou en base : suffisant
// pour empêcher deux déclenchements planifiés de se chevaucher (ex. un run anormalement long qui
// déborderait sur le suivant), pas conçu pour plusieurs instances du serveur en parallèle (hors
// périmètre actuel de ce projet).
let executionEnCours = false;

async function executerPourToutesLesEntitesActives() {
  if (executionEnCours) {
    console.log(
      'Bascule automatique "Test non réalisé" (cron) : exécution précédente encore en cours, ce déclenchement est ignoré.',
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

        // Trace du PASSAGE du cron lui-même, en plus des lignes déjà écrites PAR dossier basculé
        // (voir basculeTestNonRealiseService.js, action 'dossier_transition_test_non_realise_automatique')
        // — sert à confirmer que le cron tourne bien, même sur un run à 0 bascule
        // (resultat.total === 0), sans avoir à chercher son absence dans les logs serveur.
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
        // autres entités actives d'être traitées à ce même passage du cron.
        console.error(`Bascule automatique "Test non réalisé" (${entite.code}) : échec ✘`, erreur.message);
      }
    }
  } finally {
    executionEnCours = false;
  }
}

// Point d'entrée appelé une fois au démarrage du serveur (voir server.js). '*/15 * * * *' : toutes
// les 15 minutes, même fréquence pour toutes les entités (pas de configuration par entité pour
// l'instant, hors périmètre de cette demande).
function demarrerCronBasculeTestNonRealise() {
  cron.schedule('*/15 * * * *', () => {
    executerPourToutesLesEntitesActives().catch((erreur) => {
      console.error('Bascule automatique "Test non réalisé" (cron) : échec inattendu ✘', erreur);
    });
  });
  console.log('Cron "Bascule automatique Test non réalisé" démarré (toutes les 15 minutes).');
}

module.exports = { demarrerCronBasculeTestNonRealise, executerPourToutesLesEntitesActives };
