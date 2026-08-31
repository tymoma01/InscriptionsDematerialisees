// Point d'entrée prod du job "rappel automatique de créneau" (CLAUDE.md, besoin Accueil/
// Coordination) — destiné à être invoqué par un Azure Container Apps Job (trigger Schedule).
// Décision utilisateur, 2026-08-31 : remplace l'ancien mécanisme in-process (node-cron dans
// server.js), non fiable sur un hébergement Container Apps qui scale-to-zero/scale-out (voir
// src/jobs/rappelJob.js pour le détail du raisonnement). Traite TOUTES les entités actives, pas
// une seule — contrairement à executerRappels.js, gardé tel quel pour un déclenchement manuel
// ciblé sur une entité.
//
// Le Job Azure peut être déclenché plus souvent que nécessaire (cron UTC, pas de fuseau horaire) :
// c'est ce script qui vérifie qu'on est bien dans la fenêtre 13h30-13h44 heure de Paris avant
// d'agir (voir src/jobs/fenetreHoraireParis.js), pour rester correct à travers les changements
// d'heure été/hiver sans avoir à retoucher la configuration Azure deux fois par an. Volontairement
// APRÈS le passage de 13h00 du job de sync calendrier (voir
// executerSyncCalendrierManuelToutesEntites.js) — même contrainte d'ordonnancement que l'ancien
// cron in-process.
//
// Usage : node scripts/executerRappelsToutesEntites.js

const { obtenirKnex } = require('../src/db/knex');
const { executerPourToutesLesEntitesActives } = require('../src/jobs/rappelJob');
const { estDansLaFenetreHoraireParis } = require('../src/jobs/fenetreHoraireParis');

async function main() {
  if (!estDansLaFenetreHoraireParis(13, 30)) {
    console.log('Rappel automatique de créneau : hors fenêtre (13h30 heure de Paris), aucune action.');
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
  console.error('Échec de l’exécution des rappels ✘');
  console.error(erreur.message);
  process.exit(1);
});
