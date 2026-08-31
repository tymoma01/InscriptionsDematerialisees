// Point d'entrée prod du job "synchronisation calendrier manuelle" (détecte les modifications
// faites directement dans Outlook — voir src/core/rendezvous/syncCalendrierManuelService.js) —
// destiné à être invoqué par un Azure Container Apps Job (trigger Schedule). Décision utilisateur,
// 2026-08-31 : remplace l'ancien mécanisme in-process (node-cron dans server.js), non fiable sur un
// hébergement Container Apps qui scale-to-zero/scale-out (voir src/jobs/syncCalendrierManuelJob.js
// pour le détail du raisonnement). Traite TOUTES les entités actives.
//
// Le Job Azure peut être déclenché plus souvent que nécessaire (cron UTC, pas de fuseau horaire) :
// c'est ce script qui vérifie qu'on est bien dans l'une des fenêtres 8h00-8h14 ou 13h00-13h14
// heure de Paris avant d'agir (voir src/jobs/fenetreHoraireParis.js), pour rester correct à
// travers les changements d'heure été/hiver sans avoir à retoucher la configuration Azure deux
// fois par an.
//
// Usage : node scripts/executerSyncCalendrierManuelToutesEntites.js

const { obtenirKnex } = require('../src/db/knex');
const { executerPourToutesLesEntitesActives } = require('../src/jobs/syncCalendrierManuelJob');
const { estDansLaFenetreHoraireParis } = require('../src/jobs/fenetreHoraireParis');

async function main() {
  if (!estDansLaFenetreHoraireParis(8, 0) && !estDansLaFenetreHoraireParis(13, 0)) {
    console.log('Synchronisation calendrier manuelle : hors fenêtre (8h00/13h00 heure de Paris), aucune action.');
    return;
  }

  const bd = await obtenirKnex();
  try {
    await executerPourToutesLesEntitesActives();
  } finally {
    await bd.destroy();
  }
}

main().catch((erreur) => {
  console.error('Échec de l’exécution de la synchronisation calendrier ✘');
  console.error(erreur.message);
  process.exit(1);
});
