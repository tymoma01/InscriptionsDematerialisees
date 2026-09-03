// Point d'entrée prod du job "synchronisation calendrier manuelle" (détecte les modifications
// faites directement dans Outlook — voir src/core/rendezvous/syncCalendrierManuelService.js) —
// destiné à être invoqué par un Azure Container Apps Job (trigger Schedule). Décision utilisateur,
// 2026-08-31 : remplace l'ancien mécanisme in-process (node-cron dans server.js), non fiable sur un
// hébergement Container Apps qui scale-to-zero/scale-out (voir src/jobs/syncCalendrierManuelJob.js
// pour le détail du raisonnement). Traite TOUTES les entités actives.
//
// Cadence métier : toutes les heures (décision utilisateur, 2026-09-03 — remplace les deux
// passages fixes 8h00/13h00 initiaux). Le Job Azure peut être déclenché plus souvent que
// nécessaire (cron UTC, pas de fuseau horaire, ex. */15 * * * *) : c'est ce script qui vérifie
// qu'on est bien dans le premier quart d'heure de l'heure courante, Europe/Paris (voir
// src/jobs/fenetreHoraireParis.js), pour rester correct à travers les changements d'heure
// été/hiver sans avoir à retoucher la configuration Azure deux fois par an — pas besoin
// d'ajuster le cron Azure pour ce changement de cadence, seule cette vérification interne change.
//
// Usage : node scripts/executerSyncCalendrierManuelToutesEntites.js

const { obtenirKnex } = require('../src/db/knex');
const { executerPourToutesLesEntitesActives } = require('../src/jobs/syncCalendrierManuelJob');
const { estDansLesPremieresMinutesDeLHeureParis } = require('../src/jobs/fenetreHoraireParis');

async function main() {
  if (!estDansLesPremieresMinutesDeLHeureParis()) {
    console.log('Synchronisation calendrier manuelle : hors fenêtre (premier quart d’heure de l’heure courante), aucune action.');
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
