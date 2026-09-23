// Amorce le motif 'neutralise_par_forcage' (table `motifs`, migration 007, générique) pour TOUTES
// les entités actives — bloc 2 (audit 2026-09-23, workflowEngine.forcerStatut) : quand un Admin
// force le statut d'un dossier, tout rendez-vous 'test' encore actif ('prevu'/'confirme') passe
// désormais à 'annule' avec ce motif, jamais 'remplace' (réservé à une VRAIE replanification, voir
// rendezvousService.creerRendezvous).
//
// `categorie` = 'systeme', PAS 'desistement' (décision explicite, phase A de ce chantier) :
// rendezvousService.changerStatutRendezvous — utilisé par le bouton "Marquer annulé"/NSPP côté
// agent, le filet 24h absence et la synchronisation Outlook — recherche TOUJOURS un motif dans
// categorie 'desistement', jamais une autre. Un motif 'systeme' n'apparaît donc jamais dans
// listerMotifsDesistement() (menu agent, GestionRendezvous.jsx) : ce n'est pas un motif qu'un agent
// choisit, seul workflowEngine.forcerStatut le résout directement (categorie 'systeme' explicite,
// jamais via changerStatutRendezvous).
//
// Contrairement à scripts/seedMotifsDesistement.js (un seul motif, mais générique — pas propre à
// ACCECIT : forcerStatut est une capacité du moteur de workflow lui-même, pas d'une entité
// précise), ce script boucle sur TOUTES les entités actives plutôt que de prendre un code d'entité
// en argument — rien à personnaliser par entité pour ce motif.
//
// Idempotent. Usage : node scripts/seedMotifNeutraliseParForcage.js

const { obtenirKnex } = require('../src/db/knex');

const CATEGORIE = 'systeme';
const CODE = 'neutralise_par_forcage';
const LIBELLE = 'Neutralisé par forçage de statut';

async function seedMotifNeutraliseParForcage() {
  const bd = await obtenirKnex();
  try {
    const entites = await bd('entites').where({ actif: true });
    if (entites.length === 0) {
      console.log('Aucune entité active — rien à faire.');
      return;
    }

    for (const entite of entites) {
      const existant = await bd('motifs').where({ entite_id: entite.id, categorie: CATEGORIE, code: CODE }).first();
      if (existant) {
        console.log(`Motif « ${CODE} » déjà présent pour « ${entite.code} » (id=${existant.id}) ✔`);
        continue;
      }

      const [inseree] = await bd('motifs')
        .insert({ entite_id: entite.id, categorie: CATEGORIE, code: CODE, libelle: LIBELLE })
        .returning('id');
      console.log(`Motif « ${CODE} » créé pour « ${entite.code} » (id=${inseree.id}) ✔`);
    }
  } finally {
    await bd.destroy();
  }
}

seedMotifNeutraliseParForcage().catch((erreur) => {
  console.error('Échec du seed ✘');
  console.error(erreur.message);
  process.exit(1);
});
