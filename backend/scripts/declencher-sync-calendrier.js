// Déclenchement MANUEL, ponctuel, du job "Synchronisation calendrier manuelle" — outil de test
// pour vérifier le comportement du job sans attendre le prochain passage programmé (8h00/13h00
// heure de Paris, voir src/jobs/syncCalendrierManuelCron.js en dev local, ou le trigger Schedule
// Azure Container Apps Job en prod qui invoque scripts/executerSyncCalendrierManuelToutesEntites.js).
//
// Appelle DIRECTEMENT executerPourToutesLesEntitesActives (src/jobs/syncCalendrierManuelJob.js) —
// la même fonction que les deux déclencheurs ci-dessus, donc EXACTEMENT les mêmes règles métier et
// les mêmes lignes de log ("X annulé(s), Y déplacé(s), Z inchangé(s), ... sur N rendez-vous
// vérifié(s)") qu'une exécution programmée normale. Seule différence assumée : ce script saute la
// vérification de fenêtre horaire (estDansLaFenetreHoraireParis, scripts/
// executerSyncCalendrierManuelToutesEntites.js) — cette fenêtre n'est PAS une règle métier, c'est
// un garde-fou anti-sur-déclenchement propre au trigger Schedule Azure (cron UTC, granularité plus
// large que la minute) : ce script EST le déclenchement volontaire hors fenêtre que ce garde-fou
// existe justement pour empêcher un cron mal calé de faire à répétition.
//
// Ne modifie ni ne remplace la programmation existante (cron 8h00/13h00 en dev, trigger Schedule
// Azure en prod) : ce script est un point d'entrée additionnel, exécutable à la demande.
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
