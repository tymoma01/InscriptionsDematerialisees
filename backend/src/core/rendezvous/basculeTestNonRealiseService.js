const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const journalAudit = require('../audit/journalAudit');
const { ROLES } = require('../auth/rbac');

const CODE_ACTION_TEST_NON_REALISE = 'test_non_realise';

// Motif de désistement dédié (categorie 'desistement', voir scripts/seedMotifsDesistement.js) —
// obligatoire ici comme pour tout passage de rendez-vous à 'absent' (rendezvousService.
// changerStatutRendezvous, STATUTS_DESISTEMENT) : distinct des motifs de désistement manuels
// (ne_repond_plus, indisponible...), pour que le tableau de bord puisse un jour distinguer un
// désistement constaté par un agent d'une absence détectée automatiquement par cette tâche (audit
// du 2026-08-20, corrige le trou de synchronisation constaté sur le dossier #84).
const CODE_MOTIF_RENDEZVOUS_TEST_NON_REALISE = 'test_non_realise';

const FORMAT_DATE_HEURE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

// Point d'entrée unique de la bascule automatique "Test non réalisé" (CLAUDE.md, étape 8 du
// parcours : "si le candidat ne se présente pas, reprogrammation possible... avec motif d'absence
// enregistré") — mécanisme de déclenchement en production non tranché à ce stade, même situation
// que rappelService.js (cron externe, tâche planifiée, Azure Function Timer... voir
// scripts/executerBasculeTestNonRealise.js, le point d'entrée que ce mécanisme doit invoquer
// périodiquement, ex. toutes les heures).
//
// Réutilise exactement le même mécanisme que le bouton manuel "Test non réalisé"
// (ListeEvaluationsAFaire.jsx, marquerNonRealise) : workflowEngine.appliquerTransition avec le
// codeAction 'test_non_realise' (workflow.config.json, test_planifie -> test_non_realise) — aucune
// logique de transition dupliquée ici, seulement la sélection des rendez-vous éligibles et
// l'acteur (utilisateur système, voir dossierRepository.trouverUtilisateurSysteme, même patron que
// rappelService.js). roleCode SYSTEME doit être autorisé pour ce codeAction dans
// transitions_statut/transition_roles (voir scripts/seedTransitionRoles.js) — sans cette ligne de
// configuration, appliquerTransition refuserait l'action (fail closed, voir workflowEngine.js).
//
// Ferme aussi le rendez-vous lui-même depuis le 2026-08-20 (audit dossier #84) : jusque-là, seul
// dossiers.statut_id changeait — rendezvous.statut restait 'prevu', et les boutons "Confirmer la
// présence"/"Marquer absent"/"Marquer annulé" de la fiche dossier restaient actifs sur un
// rendez-vous que le système venait pourtant de trancher. rendezvousService.changerStatutRendezvous
// (statut 'absent') est appelé AVANT workflowEngine.appliquerTransition, dans la même transaction
// par rendez-vous ci-dessous : le garde-fou STATUTS_DOSSIER_RENDEZVOUS_CLOS de
// changerStatutRendezvous lit le statut du dossier au moment de l'appel, encore test_planifie à cet
// instant précis (voir clotureRendezvousAvecTransitionService.js pour le même ordre côté bouton
// manuel).
//
// Idempotent par construction : ne sélectionne que des rendez-vous encore 'prevu' sur un dossier
// encore 'test_planifie' (voir rendezvousRepository.listerRendezvousTestNonRealisesAutomatiquement)
// — un rendez-vous déjà basculé (dossier passé à test_non_realise) ne réapparaît plus au run
// suivant, rejouable sans risque de double transition.
async function executerBasculeTestNonRealise(entite) {
  const bd = await db.obtenirKnex();

  const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
  if (!utilisateurSysteme) {
    throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » (voir scripts/seedUtilisateurSysteme.js).`);
  }

  const rendezvousEligibles = await rendezvousRepository.listerRendezvousTestNonRealisesAutomatiquement(bd, entite.id);

  let bascules = 0;
  let ignores = 0;
  let echecs = 0;

  for (const rendezvous of rendezvousEligibles) {
    try {
      // Une transaction PAR rendez-vous (pas une seule pour tout le lot) : un échec sur l'un ne
      // doit jamais annuler les bascules déjà réussies sur les autres.
      const bascule = await bd.transaction(async (trx) => {
        // Relecture verrouillée juste avant d'écrire : revérifie l'état RÉEL du rendez-vous au
        // moment précis de la transition, contre une action manuelle concurrente (Confirmer la
        // présence/Marquer absent/Marquer annulé) survenue entre la sélection ci-dessus et cette
        // écriture (point 2 de la demande — ne jamais écraser un rendez-vous déjà traité).
        const rendezvousActuel = await rendezvousRepository.trouverRendezvousPourBasculeVerrouillee(trx, rendezvous.id);
        if (!rendezvousActuel || rendezvousActuel.statut !== 'prevu') {
          return false;
        }

        await rendezvousService.changerStatutRendezvous(
          entite,
          {
            dossierId: rendezvous.dossier_id,
            rendezvousId: rendezvous.id,
            statut: 'absent',
            motifCode: CODE_MOTIF_RENDEZVOUS_TEST_NON_REALISE,
          },
          trx,
        );

        await workflowEngine.appliquerTransition(
          entite,
          {
            dossierId: rendezvous.dossier_id,
            codeAction: CODE_ACTION_TEST_NON_REALISE,
            commentaire: `Test non réalisé (bascule automatique — rendez-vous du ${FORMAT_DATE_HEURE.format(new Date(rendezvous.date_heure))} dépassé sans action).`,
            utilisateurId: utilisateurSysteme.id,
            roleCode: ROLES.SYSTEME,
          },
          trx,
        );

        // Même patron que POST /transitions (transitions.routes.js) : journalise en plus de
        // l'écriture historique_statuts déjà faite par appliquerTransition ci-dessus — action
        // distincte du code manuel pour rester traçable comme automatique dans le journal (acteur
        // = utilisateur système, cohérent avec le reste des transitions déjà en place).
        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSysteme.id,
          entiteId: entite.id,
          action: 'dossier_transition_test_non_realise_automatique',
          tableCible: 'historique_statuts',
          cibleId: rendezvous.dossier_id,
          donnees: { dossierId: rendezvous.dossier_id, rendezvousId: rendezvous.id, codeAction: CODE_ACTION_TEST_NON_REALISE },
        });

        return true;
      });

      if (bascule) bascules += 1;
      else ignores += 1;
    } catch (erreur) {
      console.error(
        `Échec de la bascule automatique pour le rendez-vous ${rendezvous.id} (dossier ${rendezvous.dossier_id}) :`,
        erreur.message,
      );
      echecs += 1;
    }
  }

  return { bascules, ignores, echecs, total: rendezvousEligibles.length };
}

module.exports = { executerBasculeTestNonRealise, CODE_ACTION_TEST_NON_REALISE };
