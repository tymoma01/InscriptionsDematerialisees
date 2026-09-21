const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const journalAudit = require('../audit/journalAudit');
const { ROLES } = require('../auth/rbac');

// Filet de sécurité générique (audit 2026-09-21, suite au fix de syncCalendrierManuelService.js) :
// tout dossier ENCORE test_planifie dont un rendez-vous de test est 'annule' aurait dû basculer
// vers test_non_realise (voir rendezvousService.resoudreTransitionAnnulationTest et
// docs/architecture-technique.md §7.4) — deux chemins connus posent `annule` (PATCH
// /rendezvous/:id, syncCalendrierManuelService.js), tous deux corrigés pour composer cette
// transition au moment même de l'annulation. Ce module ne connaît AUCUN de ces deux chemins : il
// se contente de rattraper, périodiquement, tout dossier qui se retrouve malgré tout dans cet état
// incohérent — reste donc utile même si les deux chemins connus restent corrects indéfiniment, au
// cas où un TROISIÈME chemin (aujourd'hui inconnu) apparaîtrait un jour et poserait 'annule' sans
// composer la transition, exactement comme syncCalendrierManuelService.js avant son propre
// correctif.
//
// Idempotent par construction (voir rendezvousRepository.listerDossiersAnnulesNonSynchronises) :
// ne sélectionne que des dossiers ENCORE test_planifie — un dossier déjà basculé (par CE job à un
// run précédent, ou par la transition immédiate d'un des deux chemins connus) ne réapparaît plus
// au run suivant.
//
// Générique (voir Modularité, CLAUDE.md) : une entité sans statut "test_planifie" dans sa
// configuration (ex. Adaptel) obtient simplement 0 dossier candidat, sans cas particulier —
// resoudreTransitionAnnulationTest (ACCECIT-flavored) n'est même jamais appelée dans ce cas.
const ACTION_JOURNAL_TRANSITION = 'dossier_transition_test_non_realise_annulation_rattrapage';

// Point d'entrée par entité — même patron que
// basculeTestNonRealiseService.executerBasculeTestNonRealise (un dossier par transaction, jamais
// un lot entier : un échec sur l'un ne doit jamais empêcher le traitement des autres).
async function executerRattrapageAnnulationTest(entite) {
  const bd = await db.obtenirKnex();

  const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
  if (!utilisateurSysteme) {
    throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » (voir scripts/seedUtilisateurSysteme.js).`);
  }

  const candidats = await rendezvousRepository.listerDossiersAnnulesNonSynchronises(bd, entite.id);

  let corriges = 0;
  let ignores = 0;
  let echecs = 0;

  for (const { dossier_id: dossierId, rendezvous_id: rendezvousId } of candidats) {
    try {
      const bascule = await bd.transaction(async (trx) => {
        // Revérifie l'état RÉEL du dossier au moment précis de l'écriture, dans la transaction —
        // resoudreTransitionAnnulationTest relit dossier/rendezvous elle-même (jamais une valeur
        // mise en cache depuis la sélection ci-dessus) : renvoie [] si le dossier a déjà quitté
        // test_planifie entre-temps (évalué, ou déjà rattrapé par un run concurrent).
        const transitions = await rendezvousService.resoudreTransitionAnnulationTest(entite, { dossierId, rendezvousId }, trx);
        if (transitions.length === 0) return false;

        for (const { codeAction, commentaire } of transitions) {
          await workflowEngine.appliquerTransition(
            entite,
            { dossierId, codeAction, commentaire, utilisateurId: utilisateurSysteme.id, roleCode: ROLES.SYSTEME },
            trx,
          );

          // Action distincte de toute autre origine de cette même transition (transition
          // immédiate PATCH, sync Outlook, bascule 24h absence...) — trace explicitement que
          // celle-ci vient du filet de sécurité horaire, pas d'un événement identifié.
          await journalAudit.enregistrerAction(trx, {
            utilisateurId: utilisateurSysteme.id,
            entiteId: entite.id,
            action: ACTION_JOURNAL_TRANSITION,
            tableCible: 'historique_statuts',
            cibleId: dossierId,
            donnees: { dossierId, rendezvousId, codeAction },
          });
        }

        return true;
      });

      if (bascule) corriges += 1;
      else ignores += 1;
    } catch (erreur) {
      console.error(`Échec du rattrapage pour le dossier ${dossierId} (rendez-vous ${rendezvousId}) :`, erreur.message);
      echecs += 1;
    }
  }

  return { corriges, ignores, echecs, total: candidats.length };
}

module.exports = { executerRattrapageAnnulationTest, ACTION_JOURNAL_TRANSITION };
