const db = require('../../db/knex');
const rendezvousService = require('./rendezvousService');
const rendezvousRepository = require('./rendezvousRepository');
const workflowEngine = require('../workflow/workflowEngine');
const { ROLES } = require('../auth/rbac');

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

  // Ownership stricte réservée au FORMATEUR (secteur Hôtel), même règle et même exemption qu'
  // evaluationEngine.verifierAssignationRendezvous pour Présent(e)/Évaluer (audit 2026-09-10, demande
  // utilisateur) — un Formateur ne peut fermer (bouton "Test non réalisé", ListeEvaluationsAFaire.jsx)
  // que SES propres rendez-vous. INSPECTEUR volontairement exempté : calendrier partagé
  // test-tertiaire@accecit.com, n'importe quel Inspecteur doit pouvoir traiter le rendez-vous d'un
  // autre. Accueil/Coordination/Admin non concernés par ce garde-fou : seul
  // ListeEvaluationsAFaire.jsx passe un rendezvousId à POST /dossiers/:id/transitions (Accueil/
  // Coordination gère les rendez-vous via PATCH /rendezvous/:id, rendezvousService.
  // changerStatutRendezvous appelé directement, voir rendezvous.routes.js — jamais ce chemin-ci).
  if (rendezvousId && roleCode === ROLES.FORMATEUR) {
    const rendezvousActuel = await rendezvousRepository.trouverRendezvousParId(bd, entite.id, rendezvousId);
    if (rendezvousActuel && rendezvousActuel.formateur_id !== utilisateurId) {
      throw new Error("Ce rendez-vous n'est pas assigné à ce formateur.");
    }
  }

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
