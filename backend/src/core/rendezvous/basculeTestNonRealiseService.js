const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const rendezvousService = require('./rendezvousService');
const workflowEngine = require('../workflow/workflowEngine');
const journalAudit = require('../audit/journalAudit');
const { ROLES } = require('../auth/rbac');
const { DUREE_TEST_MINUTES } = require('../../integrations/notifications/generateurIcs');

const CODE_ACTION_TEST_NON_REALISE = 'test_non_realise';

// Délai de grâce avant bascule automatique (audit 2026-09-09, demande utilisateur) : la fin du
// créneau (date_heure + DUREE_TEST_MINUTES, voir rendezvousRepository.
// listerRendezvousTestNonRealisesAutomatiquement) doit remonter à plus de 24h, pas seulement être
// passée — laisse le temps à un agent/formateur de régulariser (Confirmer la présence, Présent(e),
// reprogrammation...) avant toute bascule automatique en test_non_realise.
const DELAI_GRACE_BASCULE_HEURES = 24;

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
// Idempotent par construction : ne sélectionne que des rendez-vous encore 'prevu'/'confirme' sur
// un dossier encore 'test_planifie' (voir rendezvousRepository.
// listerRendezvousTestNonRealisesAutomatiquement) — un rendez-vous déjà basculé (dossier passé à
// test_non_realise) ne réapparaît plus au run suivant, rejouable sans risque de double transition.
async function executerBasculeTestNonRealise(entite) {
  const bd = await db.obtenirKnex();

  const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
  if (!utilisateurSysteme) {
    throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » (voir scripts/seedUtilisateurSysteme.js).`);
  }

  const rendezvousEligibles = await rendezvousRepository.listerRendezvousTestNonRealisesAutomatiquement(bd, entite.id, {
    dureeCreneauMinutes: DUREE_TEST_MINUTES,
    delaiGraceHeures: DELAI_GRACE_BASCULE_HEURES,
  });

  let bascules = 0;
  let ignores = 0;
  let echecs = 0;

  for (const rendezvous of rendezvousEligibles) {
    try {
      // Une transaction PAR rendez-vous (pas une seule pour tout le lot) : un échec sur l'un ne
      // doit jamais annuler les bascules déjà réussies sur les autres.
      const bascule = await bd.transaction(async (trx) => {
        // Relecture verrouillée juste avant d'écrire : revérifie l'état RÉEL du rendez-vous au
        // moment précis de la transition, contre une action manuelle concurrente (Marquer
        // absent/Marquer annulé/Présent(e)) survenue entre la sélection ci-dessus et cette
        // écriture (point 2 de la demande — ne jamais écraser un rendez-vous déjà traité).
        // ['prevu', 'confirme'] (audit 2026-09-13, dossier #114, même correctif que la sélection
        // ci-dessus, rendezvousRepository.listerRendezvousTestNonRealisesAutomatiquement) — un
        // simple `!== 'prevu'` rejetterait ici tout rendez-vous 'confirme' pourtant sélectionné
        // comme éligible juste au-dessus, rendant ce correctif sans effet. Même patron déjà en
        // place sur syncCalendrierManuelService.js (autre appelant de
        // trouverRendezvousPourBasculeVerrouillee) pour ce même garde-fou.
        const rendezvousActuel = await rendezvousRepository.trouverRendezvousPourBasculeVerrouillee(trx, rendezvous.id);
        if (!rendezvousActuel || !['prevu', 'confirme'].includes(rendezvousActuel.statut)) {
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

// Délai de grâce du filet de sécurité "présence confirmée jamais évaluée" (audit 2026-09-21,
// angle mort constaté sur les dossiers #20 Faty Dia/#21 Olabisi janet Dosunmu/#23 TEST TEST — un
// formateur/inspecteur avait constaté la présence du candidat, bouton "Présent(e)", sans jamais
// soumettre d'évaluation ensuite, et listerRendezvousTestNonRealisesAutomatiquement exclut
// DÉFINITIVEMENT tout rendez-vous avec date_presence_confirmee non nulle — ces dossiers restaient
// donc bloqués en "Test planifié" indéfiniment, sans aucun mécanisme pour les refermer).
//
// 72h, pas 24h comme la bascule "absence" ci-dessus (délai distinct, jamais le même
// DELAI_GRACE_BASCULE_HEURES) : une présence confirmée signifie qu'un formateur/inspecteur a
// physiquement traité ce candidat — une évaluation est censée suivre RAPIDEMENT après le test, à
// la différence d'une absence pure qui, elle, ne dépend d'aucune action humaine ultérieure. 24h
// suffirait largement en semaine, mais se déclencherait à tort sur un test réalisé un vendredi et
// évalué le lundi suivant (weekend non travaillé, CLAUDE.md ne mentionne aucune permanence de
// formateur le week-end) — 72h couvre ce cas (vendredi 9h + 72h = lundi 9h) sans pour autant
// laisser un dossier réellement oublié traîner des semaines : un compromis délibéré entre "ne
// jamais gêner un formateur en retard d'un jour ouvré" et "ne pas laisser un filet de sécurité
// devenir lui-même un point de blocage à rallonge".
const DELAI_GRACE_PRESENCE_SANS_EVALUATION_HEURES = 72;

// Point d'entrée du filet de sécurité — appelé par le MÊME job/cron que executerBasculeTestNonRealise
// ci-dessus (voir basculeTestNonRealiseJob.js), pas un second mécanisme de déclenchement séparé.
//
// Différence fondamentale avec executerBasculeTestNonRealise ci-dessus (demande utilisateur
// explicite, point 3) : ne touche JAMAIS rendezvous.statut ni date_presence_confirmee — aucun
// appel à rendezvousService.changerStatutRendezvous ici, uniquement workflowEngine.
// appliquerTransition sur le DOSSIER. Le rendez-vous continue donc d'afficher son statut réel
// (ex. "Présence confirmée") dans la colonne "Rendez-vous", tandis que la colonne "Statut" du
// dossier affiche "Test non réalisé" — deux informations désormais découplées, comme c'est déjà le
// cas partout ailleurs dans l'app (voir Planification.jsx, correctif du même audit qui a retiré la
// dérivation "Non réalisé" qui les confondait justement à tort).
//
// Idempotent par construction, même raisonnement que executerBasculeTestNonRealise : ne sélectionne
// que des dossiers encore test_planifie (voir rendezvousRepository.
// listerRendezvousPresenceConfirmeeSansEvaluation) — un dossier déjà basculé au run précédent ne
// réapparaît plus au suivant.
async function executerBasculePresenceConfirmeeSansEvaluation(entite) {
  const bd = await db.obtenirKnex();

  const utilisateurSysteme = await dossierRepository.trouverUtilisateurSysteme(bd, entite.id);
  if (!utilisateurSysteme) {
    throw new Error(`Utilisateur système non configuré pour l'entité « ${entite.code} » (voir scripts/seedUtilisateurSysteme.js).`);
  }

  const rendezvousEligibles = await rendezvousRepository.listerRendezvousPresenceConfirmeeSansEvaluation(bd, entite.id, {
    delaiHeures: DELAI_GRACE_PRESENCE_SANS_EVALUATION_HEURES,
  });

  let bascules = 0;
  let ignores = 0;
  let echecs = 0;

  for (const rendezvous of rendezvousEligibles) {
    try {
      // Une transaction PAR rendez-vous, même raisonnement que executerBasculeTestNonRealise
      // ci-dessus : un échec sur l'un ne doit jamais annuler les bascules déjà réussies sur les
      // autres.
      const bascule = await bd.transaction(async (trx) => {
        // Pas d'équivalent trouverRendezvousPourBasculeVerrouillee ici : rien n'est écrit sur la
        // ligne `rendezvous` par cette fonction (voir commentaire d'en-tête), donc aucun verrou à
        // poser dessus. workflowEngine.appliquerTransition relit lui-même le statut COURANT du
        // dossier à l'intérieur de cette même transaction (jamais une valeur mise en cache depuis
        // la sélection ci-dessus) et échoue proprement (ErreurTransitionInvalide) si le dossier a
        // déjà quitté test_planifie entre-temps (évaluation soumise entre-temps, par exemple) —
        // capturé par le catch ci-dessous, compté comme un échec plutôt que de casser la boucle.
        await workflowEngine.appliquerTransition(
          entite,
          {
            dossierId: rendezvous.dossier_id,
            codeAction: CODE_ACTION_TEST_NON_REALISE,
            commentaire:
              `Test non réalisé (bascule automatique — présence confirmée le ` +
              `${FORMAT_DATE_HEURE.format(new Date(rendezvous.date_presence_confirmee))} sans évaluation enregistrée depuis).`,
            utilisateurId: utilisateurSysteme.id,
            roleCode: ROLES.SYSTEME,
          },
          trx,
        );

        await journalAudit.enregistrerAction(trx, {
          utilisateurId: utilisateurSysteme.id,
          entiteId: entite.id,
          action: 'dossier_transition_test_non_realise_presence_sans_evaluation_automatique',
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
        `Échec de la bascule "présence confirmée sans évaluation" pour le rendez-vous ${rendezvous.id} ` +
          `(dossier ${rendezvous.dossier_id}) :`,
        erreur.message,
      );
      echecs += 1;
    }
  }

  return { bascules, ignores, echecs, total: rendezvousEligibles.length };
}

module.exports = {
  executerBasculeTestNonRealise,
  executerBasculePresenceConfirmeeSansEvaluation,
  CODE_ACTION_TEST_NON_REALISE,
  DELAI_GRACE_PRESENCE_SANS_EVALUATION_HEURES,
};
