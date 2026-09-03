// Point d'entrée prod du job "rappel automatique de créneau" (CLAUDE.md, besoin Accueil/
// Coordination) — destiné à être invoqué par un Azure Container Apps Job (trigger Schedule).
// Décision utilisateur, 2026-08-31 : remplace l'ancien mécanisme in-process (node-cron dans
// server.js), non fiable sur un hébergement Container Apps qui scale-to-zero/scale-out (voir
// src/jobs/rappelJob.js pour le détail du raisonnement). Traite TOUTES les entités actives, pas
// une seule — contrairement à executerRappels.js, gardé tel quel pour un déclenchement manuel
// ciblé sur une entité.
//
// Cadence métier : 3 fois par jour, 9h00 / 13h30 / 17h00 heure de Paris (décision utilisateur,
// 2026-09-03 — remplace l'unique passage à 13h30 initial, pour couvrir le cas d'un rendez-vous
// créé/replanifié après 13h30 pour un test très proche, qui attendait sinon jusqu'au lendemain
// 13h30). Rejouable sans risque (voir rappelJob.js, idempotent). Le Job Azure peut être déclenché
// plus souvent que nécessaire (cron UTC, pas de fuseau horaire) : c'est ce script qui vérifie
// qu'on est bien dans l'une des 3 fenêtres ci-dessus avant d'agir (voir
// src/jobs/fenetreHoraireParis.js), pour rester correct à travers les changements d'heure
// été/hiver sans avoir à retoucher la configuration Azure deux fois par an. Le passage de 13h30
// reste volontairement APRÈS celui de 13h00 du job de sync calendrier (voir
// executerSyncCalendrierManuelToutesEntites.js) — même contrainte d'ordonnancement que l'ancien
// cron in-process.
//
// Usage : node scripts/executerRappelsToutesEntites.js

const { obtenirKnex } = require('../src/db/knex');
const { executerPourToutesLesEntitesActives } = require('../src/jobs/rappelJob');
const { estDansLaFenetreHoraireParis } = require('../src/jobs/fenetreHoraireParis');

async function main() {
  const dansUneFenetre =
    estDansLaFenetreHoraireParis(9, 0) || estDansLaFenetreHoraireParis(13, 30) || estDansLaFenetreHoraireParis(17, 0);

  if (!dansUneFenetre) {
    console.log('Rappel automatique de créneau : hors fenêtre (9h00/13h30/17h00 heure de Paris), aucune action.');
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
