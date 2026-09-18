const db = require('../../db/knex');
const rendezvousService = require('./rendezvousService');
const rendezvousRepository = require('./rendezvousRepository');
const workflowEngine = require('../workflow/workflowEngine');
const invitationTestService = require('./invitationTestService');

// Levée par l'invariant a posteriori ci-dessous (audit 2026-09-19) — distincte de
// workflowEngine.ErreurTransitionInvalide (les transitions elles-mêmes se sont toutes appliquées
// sans erreur individuelle ; c'est leur EFFET COMBINÉ sur le rendez-vous qui vient d'être créé qui
// est incohérent). Exportée pour que l'appelant HTTP (rendezvous.routes.js) puisse la distinguer et
// répondre 409, même patron que ErreurRendezvousDossierClos (rendezvousService.js).
class ErreurRendezvousNeutraliseParSesPropresTransitions extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurRendezvousNeutraliseParSesPropresTransitions';
  }
}

// Voir docs/architecture-technique.md §7 (Synchronisation rendez-vous ↔ statut dossier), §7.2 en
// particulier pour l'invariant a posteriori plus bas dans ce fichier.
//
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
  {
    dossierId,
    typeRdv,
    dateHeure,
    formateurId,
    lieuId,
    postesSelectionnes,
    notePlanification,
    transitions,
    utilisateurId,
    roleCode,
  },
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
      { dossierId, typeRdv, dateHeure, formateurId, lieuId, postesSelectionnes, notePlanification },
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

    // Invariant a posteriori (audit 2026-09-19, demande utilisateur, suite à l'audit "Suivi des
    // tests" — dossier #127) : relit le rendez-vous qu'on vient de créer APRÈS avoir appliqué
    // `transitions`. S'il n'est plus 'prevu'/'confirme', c'est qu'il vient d'être neutralisé en
    // 'remplace' — effet de bord de workflowEngine.appliquerTransition/
    // neutraliserRendezvousActifsDossier quand une des transitions demandées mène à un statut dont
    // `neutralise_rendezvous_actifs` vaut vrai (migration 051). On ne planifie jamais un rendez-vous
    // pour, dans le même geste, le neutraliser : ce cas signale que `transitions` ne correspondait
    // pas à cette planification (mauvais codeAction envoyé par le front), pas une combinaison
    // valide. Chaque transition individuelle a pu s'appliquer sans lever
    // ErreurTransitionInvalide (l'origine attendue par transitions_statut correspondait bien au
    // statut du dossier) — c'est leur EFFET COMBINÉ sur CE rendez-vous précis qui est incohérent,
    // undétectable transition par transition.
    // Générique (aucun codeAction/statut ACCECIT en dur ici, voir Modularité, CLAUDE.md) : le seul
    // contrat vérifié est "un rendez-vous fraîchement créé dans cette même transaction doit rester
    // actif", valable pour n'importe quelle entité/type de rendez-vous. Lève AVANT le `return` :
    // la transaction englobante fait tout rollback (création ET transitions), même filet que le
    // garde-fou de délai plus haut — jamais de rendez-vous "planifié puis neutralisé" persisté.
    if (transitions.length > 0) {
      const rendezvousApresTransitions = await rendezvousRepository.trouverRendezvousParId(trx, entite.id, rendezvous.id);
      if (!['prevu', 'confirme'].includes(rendezvousApresTransitions.statut)) {
        throw new ErreurRendezvousNeutraliseParSesPropresTransitions(
          `Les transitions demandées ("${transitions.map(({ codeAction }) => codeAction).join(', ')}") ont neutralisé ` +
            `(statut "${rendezvousApresTransitions.statut}") le rendez-vous qui venait pourtant d'être créé — cette combinaison ` +
            "ne correspond probablement pas à une planification valide.",
        );
      }
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

module.exports = { planifierRendezvousAvecTransitions, ErreurRendezvousNeutraliseParSesPropresTransitions };
