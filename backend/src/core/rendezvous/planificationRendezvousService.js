const db = require('../../db/knex');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const invitationTestService = require('./invitationTestService');

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

  const resultat = await bd.transaction(async (trx) => {
    // Garde-fou propre à ACCECIT (délai avant le créneau actuel) — reçoit `transitions` tel quel,
    // sans que ce module ait à en interpréter le contenu (voir rendezvousService.
    // verifierDelaiAvantReplanification, qui décide seul si ce garde-fou s'applique). Avant la
    // création du rendez-vous : pas la peine de créer une ligne qui serait de toute façon annulée
    // par le rollback de la transaction si ce garde-fou lève une erreur.
    await rendezvousService.verifierDelaiAvantReplanification(entite, dossierId, transitions, trx);

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

  // Convocation (email + .ics, SMS) envoyée seulement une fois la transaction validée, jamais à
  // l'intérieur (voir invitationTestService.js) — couvre à la fois une planification initiale et
  // une replanification, puisque les deux passent par cette même fonction avec typeRdv === 'test'.
  // Un échec d'envoi ne fait jamais échouer la planification elle-même : le rendez-vous reste
  // créé, `notification` reflète simplement ce qui a réellement été envoyé pour que l'agent
  // puisse relancer manuellement si besoin.
  const notification =
    typeRdv === 'test'
      ? await invitationTestService.envoyerInvitationTest(entite, resultat.rendezvous)
      : { emailEnvoye: false, smsEnvoye: false };

  return { ...resultat, notification };
}

module.exports = { planifierRendezvousAvecTransitions };
