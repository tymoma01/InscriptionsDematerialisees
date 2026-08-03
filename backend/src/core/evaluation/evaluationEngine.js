const db = require('../../db/knex');
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const evaluationRepository = require('./evaluationRepository');
const workflowEngine = require('../workflow/workflowEngine');
const { ROLES } = require('../auth/rbac');

// Moteur d'évaluation du test (voir docs/architecture-technique.md §1.5) : le contenu du
// questionnaire (questions, items) ne vient jamais d'ici — voir questionnaireEvaluation (migration
// 037), un questionnaire par poste recherché, avec repli générique si le poste n'a pas de
// questionnaire dédié (Modularité, CLAUDE.md). Seules les échelles de réponse ci-dessous sont
// communes à toute entité : ce n'est pas un vocabulaire métier comme les questions elles-mêmes,
// mais la forme même des 2 types de grille (grille_qcu / choix_multiple) — même statut que les
// canaux de relance (petite énumération fixe, pas de table dédiée).
const RESULTATS_GLOBAUX_AUTORISES = ['valide', 'invalide'];
// aucune_connaissance/excellent : échelle du questionnaire bureau (Inspecteur, voir
// seedQuestionnairesEvaluation.js, questions savoir_etre/savoir_faire) — a_ameliorer déjà commun
// aux deux échelles. Union plutôt qu'une échelle configurable par questionnaire : la forme d'une
// question grille_qcu reste commune à toute entité (voir commentaire d'en-tête de ce fichier),
// seul le vocabulaire affiché diffère côté front (GrilleEvaluation.jsx, NIVEAUX_BUREAU vs ACQUIS).
const ACQUIS_AUTORISEES = ['acquis', 'non_acquis', 'a_ameliorer', 'aucune_connaissance', 'excellent'];
const CHOIX_MULTIPLE_VALEURS = ['coche', 'non_coche'];
// Orientation du candidat en cas de verdict positif (workflow v3, simplification du parcours
// décidée avec la responsable de projet : plus d'étape de validation recruteur intermédiaire, le
// formateur statue directement sur l'issue finale du dossier) — sans objet si resultatGlobal
// vaut 'invalide', jamais lu dans ce cas (voir enregistrerEvaluation ci-dessous).
const ORIENTATIONS_AUTORISEES = ['envoi_formation', 'pret_embauche'];

// Vocabulaire de resultatGlobal/orientation (propre à evaluationEngine) traduit vers les
// codeAction de la machine à états du dossier — à ne pas confondre avec le statut de dossier
// "valide" (workflow hérité, plus jamais atteint pour une nouvelle évaluation), simple
// coïncidence de vocabulaire. Workflow v4 (voir enregistrerEvaluation ci-dessous, retrait de
// en_attente_verdict) : transition directe depuis test_planifie vers l'issue finale, plus de
// passage par un verdict intermédiaire ni par le recruteur — voir workflow.config.json.
const CODE_ACTION_PAR_ORIENTATION = {
  envoi_formation: 'valider_envoi_formation',
  pret_embauche: 'valider_pret_embauche',
};
const CODE_ACTION_INVALIDATION = 'invalider_test';
// Verdict positif d'un Inspecteur (postes bureau) : pas de notion de formation, donc pas de choix
// d'orientation à traduire — un seul chemin possible, réutilise directement le codeAction hôtel
// "prêt à l'embauche" (même statut final valide_pret_embauche, voir enregistrerEvaluation
// ci-dessous). Pas de nouveau statut/codeAction bureau : la sémantique de valider_pret_embauche
// s'applique déjà exactement à ce cas.
const CODE_ACTION_VALIDE_BUREAU = 'valider_pret_embauche';

// Vérifie que le poste choisi par le formateur (quand plusieurs postes sont déclarés sur le
// dossier, voir GrilleEvaluation.jsx) correspond réellement à un poste attendu pour CE rendez-vous
// — jamais de confiance dans ce qu'un client envoie, un formateur ne doit pas pouvoir demander le
// questionnaire d'un poste sans rapport. posteCode absent (null/undefined) est toujours accepté :
// retombe sur le questionnaire générique.
//
// postesSelectionnes (Phase 1, planification RDV, voir rendezvous.postes_selectionnes — migration
// 039) : le(s) poste(s) que l'agent Accueil a retenus pour CE test précis, prioritaires sur les
// postes déclarés au dossier quand renseignés (non vide) — repli sur
// evaluationRepository.trouverPostesDossier (comportement inchangé) si vide, ex. anciens
// rendez-vous créés avant cette colonne, ou aucun poste décoché à la planification.
async function resoudrePosteCode(bd, dossierId, posteCode, postesSelectionnes = []) {
  if (!posteCode) return null;
  let postesAutorises = postesSelectionnes;
  if (postesAutorises.length === 0) {
    const { posteBureau, posteHotel } = await evaluationRepository.trouverPostesDossier(bd, dossierId);
    postesAutorises = [...posteBureau, ...posteHotel];
  }
  if (!postesAutorises.includes(posteCode)) {
    throw new Error(`Le poste "${posteCode}" ne correspond à aucun poste déclaré pour ce dossier.`);
  }
  return posteCode;
}

// Valide que les réponses reçues couvrent EXACTEMENT le questionnaire résolu (ni item manquant,
// ni réponse en trop) — même exigence que l'ancienne grille de critères : une grille partielle
// est refusée plutôt qu'enregistrée à moitié. reponsesRecues : [{ questionCode, questionItemCode?,
// valeur }], jamais d'identifiant numérique envoyé par le client (les codes sont stables, pas les
// id internes). Retourne les réponses résolues avec les id réels : [{ questionId, questionItemId,
// valeur }].
function resoudreEtValiderReponses(questions, reponsesRecues) {
  const reponsesParCle = new Map((reponsesRecues ?? []).map((r) => [`${r.questionCode}:${r.questionItemCode ?? ''}`, r.valeur]));
  const clesAttendues = new Set();
  const resolues = [];

  for (const question of questions) {
    if (question.type_question === 'texte_libre') {
      const cle = `${question.code}:`;
      clesAttendues.add(cle);
      const valeur = reponsesParCle.get(cle);
      if (question.obligatoire && (!valeur || !valeur.trim())) {
        throw new Error(`Réponse obligatoire manquante pour la question "${question.libelle}".`);
      }
      resolues.push({ questionId: question.id, questionItemId: null, valeur: valeur ?? '' });
      continue;
    }

    const valeursAutorisees = question.type_question === 'grille_qcu' ? ACQUIS_AUTORISEES : CHOIX_MULTIPLE_VALEURS;
    for (const item of question.items) {
      const cle = `${question.code}:${item.code}`;
      clesAttendues.add(cle);
      const valeur = reponsesParCle.get(cle);
      if (!valeursAutorisees.includes(valeur)) {
        throw new Error(
          `Réponse "${valeur}" invalide pour « ${question.libelle} — ${item.libelle} » (attendu : ${valeursAutorisees.join(', ')}).`,
        );
      }
      resolues.push({ questionId: question.id, questionItemId: item.id, valeur });
    }
  }

  if (reponsesParCle.size !== clesAttendues.size || ![...clesAttendues].every((cle) => reponsesParCle.has(cle))) {
    throw new Error('Les réponses soumises ne correspondent pas au questionnaire configuré pour ce poste.');
  }

  return resolues;
}

// Questionnaire résolu pour le poste choisi (ou générique) — appelé par le front avant
// d'afficher la grille (voir GrilleEvaluation.jsx). Ne revalide rien d'autre que l'accès au
// rendez-vous : la validation complète des réponses n'a lieu qu'à la soumission
// (enregistrerEvaluation), jamais ici (lecture seule).
async function listerQuestionnaire(entite, { rendezvousId, formateurId, roleCode, posteCode }) {
  const bd = await db.obtenirKnex();
  const rendezvous = await rendezvousRepository.trouverRendezvousParId(bd, entite.id, rendezvousId);
  if (!rendezvous) {
    throw new Error(`Rendez-vous "${rendezvousId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  if (rendezvous.formateur_id !== formateurId && roleCode !== ROLES.ADMIN) {
    throw new Error("Ce rendez-vous n'est pas assigné à ce formateur.");
  }

  const posteCodeResolu = await resoudrePosteCode(bd, rendezvous.dossier_id, posteCode, rendezvous.postes_selectionnes);
  const questionnaire = await evaluationRepository.trouverQuestionnairePourPoste(bd, entite.id, posteCodeResolu);
  if (!questionnaire) {
    throw new Error(`Aucun questionnaire d'évaluation configuré pour l'entité « ${entite.code} ».`);
  }
  return evaluationRepository.listerQuestionsAvecItems(bd, questionnaire.id);
}

// Rendez-vous de test assignés au formateur connecté et pas encore évalués — voir
// evaluationRepository.listerRendezvousAEvaluer pour le détail du filtre. Expose les postes
// déclarés sur le dossier (donnees_disponibilites, JSONB brut) pour que le front sache s'il doit
// proposer un choix de questionnaire (plusieurs postes hôtel cochés sur un même dossier — le
// formulaire d'inscription le permet, voir BlocDisponibilites.jsx) ou le résoudre seul (un
// unique poste).
async function listerRendezvousAEvaluer(entite, formateurId) {
  const bd = await db.obtenirKnex();
  const rendezvous = await evaluationRepository.listerRendezvousAEvaluer(bd, entite.id, formateurId);
  return rendezvous.map(({ donnees_disponibilites, ...reste }) => ({
    ...reste,
    postesBureau: donnees_disponibilites?.posteBureau ?? [],
    postesHotel: donnees_disponibilites?.posteHotel ?? [],
  }));
}

// Enregistre une évaluation complète (résultat global + orientation éventuelle + réponses au(x)
// questionnaire(s) résolu(s) pour le ou les postes choisis) pour un rendez-vous de test. `blocs`
// (voir GrilleEvaluation.jsx : questionnaires empilés séparément, un bloc par poste sélectionné)
// est `[{ posteCode, reponses }]` — un seul verdict global (resultatGlobal/orientation/commentaire)
// couvre l'ensemble des blocs, mais chaque bloc est résolu et revalidé côté serveur contre SON
// PROPRE questionnaire, jamais fusionné dans un même espace de clés avant validation :
// questions_evaluation n'est unique que par (questionnaire_id, code) (migration 037), deux postes
// différents peuvent réutiliser le même questionCode — les fusionner créerait des collisions
// silencieuses. Chaque bloc doit couvrir EXACTEMENT son questionnaire résolu, ni plus ni moins —
// une grille partielle est refusée plutôt qu'enregistrée à moitié (resoudreEtValiderReponses).
async function enregistrerEvaluation(
  entite,
  { rendezvousId, formateurId, roleCode, resultatGlobal, orientation, commentaire, blocs },
) {
  if (!RESULTATS_GLOBAUX_AUTORISES.includes(resultatGlobal)) {
    throw new Error(`Résultat global "${resultatGlobal}" invalide (attendu : ${RESULTATS_GLOBAUX_AUTORISES.join(', ')}).`);
  }
  // Orientation obligatoire uniquement en cas de verdict positif (voir ORIENTATIONS_AUTORISEES
  // ci-dessus) — sans objet, et ignorée, si le test est invalidé. Sans objet non plus pour un
  // Inspecteur (postes bureau) : le bureau n'a pas de notion de formation, l'évaluation reste
  // binaire (valide/invalide) comme pour un Formateur, sans champ supplémentaire à choisir —
  // seul le rôle du soumetteur distingue les deux cas, pas une caractéristique du dossier
  // (scope procédural, voir rbac.js).
  if (resultatGlobal === 'valide' && roleCode !== ROLES.INSPECTEUR && !ORIENTATIONS_AUTORISEES.includes(orientation)) {
    throw new Error(`Orientation "${orientation}" invalide (attendu : ${ORIENTATIONS_AUTORISEES.join(', ')}).`);
  }
  if (!commentaire || !commentaire.trim()) {
    throw new Error('Un commentaire est obligatoire pour toute évaluation.');
  }
  if (!Array.isArray(blocs) || blocs.length === 0) {
    throw new Error('Au moins un bloc de réponses (un par poste évalué) est obligatoire.');
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

  // posteCodesResolus : seulement les postes réellement résolus (jamais le repli générique, sans
  // objet pour evaluations_postes — voir evaluationRepository.enregistrerPostesEvaluation). Rejette
  // un même poste résolu dans deux blocs différents : violerait l'unicité (evaluation_id,
  // poste_code) de la table, et n'a de toute façon aucun sens pour un formateur (voir migration 040).
  const posteCodesVus = new Set();
  const posteCodesResolus = [];
  let reponsesResolues = [];

  for (const bloc of blocs) {
    const posteCodeResolu = await resoudrePosteCode(bd, rendezvous.dossier_id, bloc.posteCode, rendezvous.postes_selectionnes);
    if (posteCodeResolu) {
      if (posteCodesVus.has(posteCodeResolu)) {
        throw new Error(`Le poste "${posteCodeResolu}" est présent dans plusieurs blocs de réponses.`);
      }
      posteCodesVus.add(posteCodeResolu);
      posteCodesResolus.push(posteCodeResolu);
    }

    const questionnaire = await evaluationRepository.trouverQuestionnairePourPoste(bd, entite.id, posteCodeResolu);
    if (!questionnaire) {
      throw new Error(`Aucun questionnaire d'évaluation configuré pour l'entité « ${entite.code} ».`);
    }
    const questions = await evaluationRepository.listerQuestionsAvecItems(bd, questionnaire.id);
    if (questions.length === 0) {
      throw new Error(`Aucune question configurée pour ce questionnaire (entité « ${entite.code} »).`);
    }

    reponsesResolues = reponsesResolues.concat(resoudreEtValiderReponses(questions, bloc.reponses));
  }

  return bd.transaction(async (trx) => {
    const evaluationId = await evaluationRepository.enregistrerEvaluation(trx, {
      dossierId: rendezvous.dossier_id,
      rendezvousId,
      formateurId,
      resultatGlobal,
      // Toujours NULL pour un Inspecteur, quoi qu'un client envoie (jamais de confiance dans le
      // payload) : le bureau n'a pas de notion d'orientation, voir la validation plus haut.
      orientation: resultatGlobal === 'valide' && roleCode !== ROLES.INSPECTEUR ? orientation : null,
      commentaire,
    });
    await evaluationRepository.enregistrerReponses(trx, evaluationId, reponsesResolues);
    await evaluationRepository.enregistrerPostesEvaluation(trx, evaluationId, posteCodesResolus);

    // Fait avancer le dossier dans la même transaction que l'évaluation elle-même (même patron
    // que planificationRendezvousService.planifierRendezvousAvecTransitions) — pas sur le simple
    // clic "Évaluer" qui ouvre la grille : annuler la grille avant soumission ne doit rien avancer
    // (voir Evaluation.jsx, bouton "Annuler"), donc cette transition n'est déclenchée qu'ici, au
    // moment où l'évaluation est réellement soumise.
    //
    // Workflow v4 (retrait de en_attente_verdict, responsable de projet, 2026-07-31) : transition
    // directe test_planifie -> issue finale, en une seule étape, plus de statut intermédiaire —
    // en_attente_verdict n'était de toute façon jamais observé comme état de repos (les deux
    // transitions v3 avaient déjà lieu dans la même transaction), il ne servait donc qu'à bloquer
    // à tort toute replanification une fois le test réalisé. Conséquence directe : un dossier ne
    // peut plus jamais être à la fois "évalué" et encore "test_planifie" au même instant — c'est
    // ce qui empêche une replanification concurrente de s'appliquer après coup sur un rendez-vous
    // déjà évalué (workflowEngine.appliquerTransition revérifie toujours le statut réel du dossier
    // en base, jamais une valeur mise en cache côté client) sans garde-fou supplémentaire à écrire
    // ici. roleCode reste celui du formateur/inspecteur connecté (transition_roles l'autorise
    // explicitement pour FORMATEUR et INSPECTEUR, voir seedTransitionRoles.js).
    //
    // Inspecteur (bureau) : CODE_ACTION_PAR_ORIENTATION ne connaît que envoi_formation/
    // pret_embauche (orientation reste toujours NULL pour un Inspecteur, voir plus haut) —
    // CODE_ACTION_PAR_ORIENTATION[null] vaudrait undefined et ferait échouer
    // workflowEngine.appliquerTransition ("Action \"undefined\" non autorisée"). Un verdict positif
    // bureau va donc directement à valider_pret_embauche, réutilisé tel quel : le bureau n'a pas de
    // notion de formation, son seul verdict positif correspond exactement à ce que ce statut porte
    // déjà pour le hôtel — pas de statut/codeAction bureau distinct.
    let codeActionFinal;
    if (resultatGlobal !== 'valide') {
      codeActionFinal = CODE_ACTION_INVALIDATION;
    } else if (roleCode === ROLES.INSPECTEUR) {
      codeActionFinal = CODE_ACTION_VALIDE_BUREAU;
    } else {
      codeActionFinal = CODE_ACTION_PAR_ORIENTATION[orientation];
    }
    await workflowEngine.appliquerTransition(
      entite,
      {
        dossierId: rendezvous.dossier_id,
        codeAction: codeActionFinal,
        commentaire,
        utilisateurId: formateurId,
        roleCode,
      },
      trx,
    );

    return { evaluationId };
  });
}

// Historique des évaluations déjà soumises par CE formateur connecté — jamais tous formateurs
// confondus (voir evaluationRepository.listerEvaluationsParFormateur). Un candidat peut avoir
// plusieurs entrées si repassé un test pour un poste différent (poste_code distinct par ligne,
// voir migration 038) : volontairement pas dédupliqué par candidat.
async function listerHistorique(entite, formateurId) {
  const bd = await db.obtenirKnex();
  return evaluationRepository.listerEvaluationsParFormateur(bd, entite.id, formateurId);
}

// Détail en lecture seule d'une évaluation déjà soumise (voir DetailEvaluation.jsx) — jamais
// modifiable depuis cet écran. Vérifie que l'évaluation appartient bien à CE formateur (ou à un
// admin) avant de renvoyer quoi que ce soit, même garde IDOR que listerQuestionnaire/
// enregistrerEvaluation ci-dessus.
async function obtenirDetailEvaluation(entite, { evaluationId, formateurId, roleCode }) {
  const bd = await db.obtenirKnex();
  const evaluation = await evaluationRepository.trouverEvaluationParId(bd, entite.id, evaluationId);
  if (!evaluation) {
    throw new Error(`Évaluation "${evaluationId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  if (evaluation.formateur_id !== formateurId && roleCode !== ROLES.ADMIN) {
    throw new Error("Cette évaluation n'appartient pas à ce formateur.");
  }

  const lignes = await evaluationRepository.listerReponsesEvaluation(bd, evaluationId);
  const questionsParCode = new Map();
  for (const ligne of lignes) {
    if (!questionsParCode.has(ligne.question_code)) {
      questionsParCode.set(ligne.question_code, {
        code: ligne.question_code,
        libelle: ligne.question_libelle,
        type_question: ligne.type_question,
        items: [],
        valeur: null,
      });
    }
    const question = questionsParCode.get(ligne.question_code);
    if (ligne.item_code) {
      question.items.push({ code: ligne.item_code, libelle: ligne.item_libelle, valeur: ligne.valeur });
    } else {
      question.valeur = ligne.valeur;
    }
  }

  return {
    evaluation: {
      id: evaluation.id,
      resultatGlobal: evaluation.resultat_global,
      orientation: evaluation.orientation,
      // Agrégé côté requête (evaluationRepository.trouverEvaluationParId, evaluations_postes,
      // migration 040) — tableau vide si évaluation générique (aucun poste dédié).
      postesCodes: evaluation.postes_codes ?? [],
      commentaire: evaluation.commentaire,
      dateEvaluation: evaluation.date_evaluation,
      candidatPrenom: evaluation.candidat_prenom,
      candidatNom: evaluation.candidat_nom,
    },
    questions: [...questionsParCode.values()],
  };
}

module.exports = {
  listerQuestionnaire,
  listerRendezvousAEvaluer,
  enregistrerEvaluation,
  listerHistorique,
  obtenirDetailEvaluation,
};
