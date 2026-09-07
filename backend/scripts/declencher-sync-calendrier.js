// Déclenchement MANUEL, ponctuel, du job "Synchronisation calendrier manuelle" — outil de test
// pour vérifier le comportement du job sans attendre le prochain passage programmé (cron
// in-process toutes les heures, voir src/jobs/syncCalendrierManuelCron.js, chargé en dev ET en
// prod).
//
// Appelle DIRECTEMENT executerPourToutesLesEntitesActives (src/jobs/syncCalendrierManuelJob.js) —
// la même fonction que le cron programmé, donc EXACTEMENT les mêmes règles métier et les mêmes
// lignes de log ("X annulé(s), Y déplacé(s), Z inchangé(s), ... sur N rendez-vous vérifié(s)")
// qu'une exécution programmée normale.
//
// Ne modifie ni ne remplace la programmation existante (cron in-process) : ce script est un point
// d'entrée additionnel, exécutable à la demande.
//
// Usage : node scripts/declencher-sync-calendrier.js
const { obtenirKnex } = require('../src/db/knex');
const { executerPourToutesLesEntitesActives } = require('../src/jobs/syncCalendrierManuelJob');

async function main() {
  console.log('Déclenchement manuel de la synchronisation calendrier — hors fenêtre 8h00/13h00, test ponctuel.\n');
  const bd = await obtenirKnex();
  try {
    await executerPourToutesLesEntitesActives();
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec du déclenchement manuel ✘');
  console.error(erreur.message);
  process.exit(1);
});
