const db = require('../../db/knex');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');

// Compose en une seule transaction DB : (1) la création d'un rendez-vous, (2) l'application
// d'une ou plusieurs transitions de statut sur le dossier. Corrige un bug constaté (dossier 62) :
// ces deux opérations étaient deux appels HTTP/transactions séparés, donc non atomiques — quand
// la transition échouait après la création du rendez-vous (ex. le dossier avait déjà quitté le
// statut source attendu, suite à une tentative précédente), le rendez-vous restait créé sans
// changement de statut correspondant ("rendez-vous orphelin"), sans retour arrière possible.
//
// Reste générique (voir Modularité, CLAUDE.md) : `transitions` est une liste ordonnée de
// {codeAction, commentaire, motifCode} décidée par l'appelant (voir CaptureTablette.jsx, qui la
// construit à partir de GET /transitions) — ce module ne connaît aucun codeAction en dur, et
// fonctionnerait pour n'importe quelle entité/étape composant un rendez-vous avec une ou
// plusieurs transitions.
async function planifierRendezvousAvecTransitions(
  entite,
  { dossierId, typeRdv, dateHeure, formateurId, transitions, utilisateurId, roleCode },
) {
  const bd = await db.obtenirKnex();

  return bd.transaction(async (trx) => {
    const rendezvous = await rendezvousService.creerRendezvous(
      entite,
      { dossierId, typeRdv, dateHeure, formateurId },
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

module.exports = { planifierRendezvousAvecTransitions };
