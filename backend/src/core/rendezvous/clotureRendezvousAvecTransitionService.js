const db = require('../../db/knex');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');

// Symétrique de planificationRendezvousService.planifierRendezvousAvecTransitions (même fichier
// voisin) : compose en une seule transaction DB (1) le passage d'UN rendez-vous à un statut donné
// et (2) l'application d'une ou plusieurs transitions de statut sur le dossier — pour le sens
// "fermeture" plutôt que "création". Corrige le trou constaté par l'audit du 2026-08-20 (dossier
// #84) : la bascule automatique "Test non réalisé" et son équivalent manuel (marquerNonRealise,
// ListeEvaluationsAFaire.jsx) n'appliquaient jusqu'ici que la transition du DOSSIER
// (workflowEngine.appliquerTransition), jamais le statut du RENDEZ-VOUS associé — celui-ci restait
// affiché "Prévu", boutons "Confirmer la présence"/"Marquer absent"/"Marquer annulé" toujours
// actifs comme si de rien n'était.
//
// Reste générique (voir Modularité, CLAUDE.md, même principe que
// planificationRendezvousService.js) : ce module ne connaît aucun codeAction ni statut de
// rendez-vous en dur — `statutRendezvous`/`transitions` sont décidés par l'appelant (voir
// basculeTestNonRealiseService.js pour la bascule automatique, transitions.routes.js pour le
// bouton manuel "Test non réalisé").
//
// Ordre volontaire : le rendez-vous est fermé AVANT la transition du dossier, pas après — le
// garde-fou STATUTS_DOSSIER_RENDEZVOUS_CLOS de rendezvousService.changerStatutRendezvous lit le
// statut du dossier au moment de l'appel ; s'il tournait après la transition, cet appel se
// bloquerait lui-même (le dossier serait déjà dans l'état final qu'il vient tout juste
// d'atteindre).
async function cloturerRendezvousAvecTransition(
  entite,
  { dossierId, rendezvousId, statutRendezvous, motifCodeRendezvous, transitions, utilisateurId, roleCode },
) {
  const bd = await db.obtenirKnex();

  return bd.transaction(async (trx) => {
    const rendezvous = await rendezvousService.changerStatutRendezvous(
      entite,
      { dossierId, rendezvousId, statut: statutRendezvous, motifCode: motifCodeRendezvous },
      trx,
    );

    let resultatTransition = null;
    for (const { codeAction, commentaire, motifCode } of transitions) {
      resultatTransition = await workflowEngine.appliquerTransition(
        entite,
        { dossierId, codeAction, motifCode, commentaire, utilisateurId, roleCode },
        trx,
      );
    }

    return { rendezvous, ...resultatTransition };
  });
}

module.exports = { cloturerRendezvousAvecTransition };
