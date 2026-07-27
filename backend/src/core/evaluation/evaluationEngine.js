const db = require('../../db/knex');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const evaluationRepository = require('./evaluationRepository');
const workflowEngine = require('../workflow/workflowEngine');
const { ROLES } = require('../auth/rbac');

// Moteur d'évaluation du test (voir docs/architecture-technique.md §1.5) : les critères
// (hygiène, assiduité, respect des consignes, temps de service...) ne sont jamais nommés en dur
// ici — ils viennent de `criteres_evaluation`, scopée par entité (voir Modularité, CLAUDE.md).
// Seule l'échelle de notation (RESULTATS_GLOBAUX_AUTORISES / VALEURS_CRITERE_AUTORISEES) est
// commune à toute entité : ce n'est pas un vocabulaire métier comme les motifs, mais la forme
// même de la grille (une note à 3 niveaux par critère, un résultat global valide/invalide) —
// même statut que les canaux de relance (petite énumération fixe, pas de table dédiée).
const RESULTATS_GLOBAUX_AUTORISES = ['valide', 'invalide'];
const VALEURS_CRITERE_AUTORISEES = ['conforme', 'a_ameliorer', 'non_conforme'];

// Vocabulaire de resultatGlobal (valide/invalide, propre à evaluationEngine) traduit vers les
// codeAction de la machine à états du dossier (soumettre_verdict_positif/negatif, voir
// workflow.config.json) — à ne pas confondre avec le statut de dossier "valide" (décision finale
// recruteur), simple coïncidence de vocabulaire, voir l'audit de la machine à états.
const CODE_ACTION_PAR_RESULTAT = {
  valide: 'soumettre_verdict_positif',
  invalide: 'soumettre_verdict_negatif',
};

async function listerCriteres(entite) {
  const bd = await db.obtenirKnex();
  return evaluationRepository.listerCriteres(bd, entite.id);
}

// Rendez-vous de test assignés au formateur connecté et pas encore évalués — voir
// evaluationRepository.listerRendezvousAEvaluer pour le détail du filtre.
async function listerRendezvousAEvaluer(entite, formateurId) {
  const bd = await db.obtenirKnex();
  return evaluationRepository.listerRendezvousAEvaluer(bd, entite.id, formateurId);
}

// Enregistre une évaluation complète (résultat global + une valeur par critère configuré) pour
// un rendez-vous de test. `criteres` est la grille telle que soumise par le formulaire :
// [{ code, valeur }] — revalidée intégralement côté serveur (jamais de confiance dans ce qu'un
// client déclare avoir affiché), et doit couvrir EXACTEMENT les critères actuellement configurés
// pour l'entité, ni plus ni moins — une grille partielle est refusée plutôt qu'enregistrée à
// moitié.
async function enregistrerEvaluation(entite, { rendezvousId, formateurId, roleCode, resultatGlobal, commentaire, criteres }) {
  if (!RESULTATS_GLOBAUX_AUTORISES.includes(resultatGlobal)) {
    throw new Error(`Résultat global "${resultatGlobal}" invalide (attendu : ${RESULTATS_GLOBAUX_AUTORISES.join(', ')}).`);
  }
  if (!commentaire || !commentaire.trim()) {
    throw new Error('Un commentaire est obligatoire pour toute évaluation.');
  }

  const bd = await db.obtenirKnex();

  const rendezvous = await rendezvousRepository.trouverRendezvousParId(bd, entite.id, rendezvousId);
  if (!rendezvous) {
    throw new Error(`Rendez-vous "${rendezvousId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  if (rendezvous.type_rdv !== 'test') {
    throw new Error(`Le rendez-vous "${rendezvousId}" n'est pas un rendez-vous de test.`);
  }
  // Seul le formateur assigné à CE rendez-vous (ou un admin) peut l'évaluer — rendezvous.formateur_id
  // porte cette assignation depuis la planification (CLAUDE.md, étape "Envoi en test" : "notification
  // envoyée au formateur concerné"), ce n'est pas à n'importe quel formateur de la remplacer.
  if (rendezvous.formateur_id !== formateurId && roleCode !== ROLES.ADMIN) {
    throw new Error("Ce rendez-vous n'est pas assigné à ce formateur.");
  }

  const dejaEvaluee = await evaluationRepository.trouverEvaluationParRendezvous(bd, rendezvousId);
  if (dejaEvaluee) {
    throw new Error(`Le rendez-vous "${rendezvousId}" a déjà été évalué.`);
  }

  const criteresConfigures = await evaluationRepository.listerCriteres(bd, entite.id);
  if (criteresConfigures.length === 0) {
    throw new Error(`Aucun critère d'évaluation configuré pour l'entité « ${entite.code} ».`);
  }

  const criteresParCode = new Map(criteresConfigures.map((critere) => [critere.code, critere]));
  const codesRecus = new Set((criteres ?? []).map((c) => c.code));

  if (
    codesRecus.size !== criteresConfigures.length ||
    ![...criteresParCode.keys()].every((code) => codesRecus.has(code))
  ) {
    throw new Error(
      `La grille soumise ne correspond pas aux critères configurés pour l'entité « ${entite.code} » (attendus : ${[...criteresParCode.keys()].join(', ')}).`,
    );
  }

  const resultatsResolus = criteres.map(({ code, valeur }) => {
    if (!VALEURS_CRITERE_AUTORISEES.includes(valeur)) {
      throw new Error(
        `Valeur "${valeur}" invalide pour le critère "${code}" (attendu : ${VALEURS_CRITERE_AUTORISEES.join(', ')}).`,
      );
    }
    return { critereId: criteresParCode.get(code).id, valeur };
  });

  return bd.transaction(async (trx) => {
    const evaluationId = await evaluationRepository.enregistrerEvaluation(trx, {
      dossierId: rendezvous.dossier_id,
      rendezvousId,
      formateurId,
      resultatGlobal,
      commentaire,
    });
    await evaluationRepository.enregistrerResultatsCriteres(trx, evaluationId, resultatsResolus);

    // Fait avancer le dossier dans la même transaction que l'évaluation elle-même (même patron
    // que planificationRendezvousService.planifierRendezvousAvecTransitions) — pas sur le simple
    // clic "Évaluer" qui ouvre la grille : annuler la grille avant soumission ne doit rien avancer
    // (voir Evaluation.jsx, bouton "Annuler"), donc test_realise n'est déclenché qu'ici, au moment
    // où l'évaluation est réellement soumise. roleCode reste celui du formateur connecté pour ces
    // deux premières transitions (transition_roles les autorise explicitement pour FORMATEUR).
    await workflowEngine.appliquerTransition(
      entite,
      {
        dossierId: rendezvous.dossier_id,
        codeAction: 'test_realise',
        commentaire: 'Test réalisé — évaluation soumise par le formateur.',
        utilisateurId: formateurId,
        roleCode,
      },
      trx,
    );
    await workflowEngine.appliquerTransition(
      entite,
      {
        dossierId: rendezvous.dossier_id,
        codeAction: CODE_ACTION_PAR_RESULTAT[resultatGlobal],
        commentaire,
        utilisateurId: formateurId,
        roleCode,
      },
      trx,
    );

    // Transmission automatique au recruteur après un verdict positif — SYSTEME uniquement (jamais
    // le rôle réel du formateur, voir seedTransitionRoles.js) : ce n'est pas une action distincte
    // qu'un formateur pourrait déclencher à volonté via POST /transitions, seulement la
    // conséquence directe d'un verdict positif réellement soumis ici.
    if (resultatGlobal === 'valide') {
      await workflowEngine.appliquerTransition(
        entite,
        {
          dossierId: rendezvous.dossier_id,
          codeAction: 'transmettre_recruteur',
          commentaire: 'Verdict positif — transmission automatique au recruteur pour décision finale.',
          utilisateurId: formateurId,
          roleCode: ROLES.SYSTEME,
        },
        trx,
      );
    }

    return { evaluationId };
  });
}

module.exports = { listerCriteres, listerRendezvousAEvaluer, enregistrerEvaluation };
