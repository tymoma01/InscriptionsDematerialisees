// Accès données pour l'évaluation du test — uniquement des requêtes, aucune règle métier ici
// (orchestrée par evaluationEngine.js), même découpage que dossierRepository.js.

// Questionnaire pour un poste donné (voir migration 037, scripts/seedQuestionnairesEvaluation.js)
// — repli sur le questionnaire générique (poste_code NULL) si aucun questionnaire dédié n'existe
// pour ce poste (poste bureau, ou poste hôtel pas encore configuré, voir Modularité, CLAUDE.md :
// permet d'ajouter des postes plus tard sans faire échouer une évaluation).
async function trouverQuestionnairePourPoste(bd, entiteId, posteCode) {
  const dedie = posteCode
    ? await bd('questionnaires_evaluation').where({ entite_id: entiteId, poste_code: posteCode }).first()
    : null;
  if (dedie) return dedie;
  return bd('questionnaires_evaluation').where({ entite_id: entiteId, poste_code: null }).first();
}

// Questions du questionnaire avec leurs items (grille_qcu/choix_multiple uniquement — un
// texte_libre n'a pas d'item, voir migration 037), dans l'ordre de la grille.
async function listerQuestionsAvecItems(bd, questionnaireId) {
  const questions = await bd('questions_evaluation')
    .where({ questionnaire_id: questionnaireId })
    .orderBy('ordre', 'asc');
  const items = await bd('question_items_evaluation')
    .whereIn(
      'question_id',
      questions.map((question) => question.id),
    )
    .orderBy('ordre', 'asc');
  const itemsParQuestion = new Map();
  for (const item of items) {
    if (!itemsParQuestion.has(item.question_id)) itemsParQuestion.set(item.question_id, []);
    itemsParQuestion.get(item.question_id).push(item);
  }
  return questions.map((question) => ({ ...question, items: itemsParQuestion.get(question.id) ?? [] }));
}

// Rendez-vous de type 'test', assignés au formateur, pas encore confirmés/absent/annulés côté
// candidat ('prevu'/'confirme' uniquement) et n'ayant pas déjà d'évaluation enregistrée (voir
// enregistrerEvaluation) — c'est ce NOT EXISTS qui fait disparaître un rendez-vous de la liste
// "à évaluer" une fois l'évaluation soumise, sans avoir besoin d'un statut dédié.
//
// dossiers.statut_id IN ('test_planifie', 'test_realise') (workflow v5, audit 2026-08-21 — élargi
// depuis la seule égalité 'test_planifie' du workflow v2/v4) : cette liste sert désormais aussi de
// support à "Confirmer que le test a eu lieu" (voir dossier_statut_code exposé ci-dessous,
// ListeEvaluationsAFaire.jsx) — un rendez-vous dont le dossier est encore test_planifie affiche ce
// bouton de confirmation, un dossier déjà test_realise affiche "Évaluer" à la place. Un rendez-vous
// disparaît toujours de cette liste une fois son dossier passé à test_non_realise (voir
// evaluationEngine.enregistrerEvaluation / ListeEvaluationsAFaire.jsx, bouton "Test non réalisé")
// ou à l'une des issues finales (invalide/valide_*) — sans ce filtre, ce même rendez-vous resterait
// affiché comme "à évaluer" alors que la seule action possible dessus a déjà été prise.
//
// Jointure gauche vers dossier_donnees_formulaire (bloc 'disponibilites', JSONB, migration 013)
// pour exposer le(s) poste(s) recherché(s) — nécessaire pour charger le bon questionnaire côté
// front (voir GrilleEvaluation.jsx), même patron que dossierRepository.trouverCoordonneesCandidat.
// LEFT JOIN plutôt qu'un JOIN strict : un dossier sans bloc disponibilites enregistré (ne devrait
// pas arriver en usage normal, mais pas de raison de faire disparaître le rendez-vous pour autant)
// retombe simplement sur `donnees` null, traité comme "aucun poste connu" côté evaluationEngine.
function listerRendezvousAEvaluer(bd, entiteId, formateurId) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        bd.raw('?', ['disponibilites']),
      );
    })
    .where({
      'dossiers.entite_id': entiteId,
      'rendezvous.type_rdv': 'test',
      'rendezvous.formateur_id': formateurId,
    })
    .whereIn('statuts.code', ['test_planifie', 'test_realise'])
    .whereIn('rendezvous.statut', ['prevu', 'confirme'])
    .whereNotExists(function () {
      this.select(1).from('evaluations').whereRaw('evaluations.rendezvous_id = rendezvous.id');
    })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.date_heure',
      // Toujours 'prevu' ou 'confirme' ici (voir whereIn ci-dessus) — exposé quand même pour
      // l'affichage/la recherche côté front (ListeEvaluationsAFaire.jsx, badge de statut + champ
      // "Rechercher", audit 2026-08-20), même patron que rendezvousRepository.listerRendezvousTest
      // (Suivi des tests).
      'rendezvous.statut',
      // 'test_planifie' ou 'test_realise' (voir whereIn ci-dessus) — pilote côté front lequel des
      // deux boutons afficher par ligne ("Confirmer que le test a eu lieu" vs "Évaluer", voir
      // ListeEvaluationsAFaire.jsx, workflow v5 audit 2026-08-21).
      'statuts.code as dossier_statut_code',
      // Postes RETENUS pour CE rendez-vous précis (migration 039), distincts de
      // donnees_disponibilites (postes DÉCLARÉS à l'inscription) ci-dessous — sert à
      // GrilleEvaluation.jsx à pré-cocher les cases de postesCandidats déjà retenues au moment de
      // la planification (ModalePlanificationTest.jsx), même source de donnée que les emails de
      // convocation (voir invitationTestService.js).
      'rendezvous.postes_selectionnes',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      'bloc_disponibilites.donnees as donnees_disponibilites',
    )
    .orderBy('rendezvous.date_heure', 'asc');
}

function trouverEvaluationParRendezvous(bd, rendezvousId) {
  return bd('evaluations').where({ rendezvous_id: rendezvousId }).first();
}

// Sous-requête corrélée renvoyant le(s) poste(s) évalués (evaluations_postes, migration 040) sous
// forme de tableau Postgres, plutôt qu'un JOIN + GROUP BY : évite de devoir regrouper toutes les
// autres colonnes sélectionnées (candidat, statut...) juste pour cette agrégation. NULL (aucune
// ligne) si évaluation générique — même sémantique que l'ancienne colonne evaluations.poste_code
// NULL, voir migration 040.
const SOUS_REQUETE_POSTES_CODES = `(
  select array_agg(ep.poste_code order by ep.poste_code)
  from evaluations_postes ep
  where ep.evaluation_id = evaluations.id
) as postes_codes`;

// Historique des évaluations déjà soumises par CE formateur (formateur_id, jamais tous
// formateurs confondus) — voir evaluationEngine.listerHistorique / HistoriqueEvaluations.jsx.
// entiteId filtré via la jointure dossiers, même patron que listerRendezvousAEvaluer ci-dessus.
function listerEvaluationsParFormateur(bd, entiteId, formateurId) {
  return bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where({ 'dossiers.entite_id': entiteId, 'evaluations.formateur_id': formateurId })
    .select(
      'evaluations.id',
      'evaluations.dossier_id',
      'evaluations.resultat_global',
      'evaluations.orientation',
      'evaluations.date_evaluation',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      bd.raw(SOUS_REQUETE_POSTES_CODES),
    )
    .orderBy('evaluations.date_evaluation', 'desc');
}

// Une évaluation donnée, scopée par entité (jointure dossiers) — utilisé pour vérifier l'accès
// avant de renvoyer le détail des réponses (voir evaluationEngine.obtenirDetailEvaluation), même
// garde IDOR que trouverDossierParId/trouverRendezvousParId ailleurs dans le projet.
function trouverEvaluationParId(bd, entiteId, evaluationId) {
  return bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where({ 'evaluations.id': evaluationId, 'dossiers.entite_id': entiteId })
    .select(
      'evaluations.*',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      bd.raw(SOUS_REQUETE_POSTES_CODES),
    )
    .first();
}

// Détail des réponses d'une évaluation déjà soumise, dans l'ordre du questionnaire — lecture
// seule (voir DetailEvaluation.jsx), jamais utilisé pour reconstruire une grille modifiable.
// leftJoin sur question_items_evaluation : nullable pour une question 'texte_libre' (une seule
// réponse par question, pas par item, voir migration 037).
function listerReponsesEvaluation(bd, evaluationId) {
  return bd('evaluation_reponses')
    .join('questions_evaluation', 'questions_evaluation.id', 'evaluation_reponses.question_id')
    .leftJoin('question_items_evaluation', 'question_items_evaluation.id', 'evaluation_reponses.question_item_id')
    .where('evaluation_reponses.evaluation_id', evaluationId)
    .select(
      'questions_evaluation.code as question_code',
      'questions_evaluation.libelle as question_libelle',
      'questions_evaluation.type_question',
      'questions_evaluation.ordre as question_ordre',
      'question_items_evaluation.code as item_code',
      'question_items_evaluation.libelle as item_libelle',
      'question_items_evaluation.ordre as item_ordre',
      'evaluation_reponses.valeur',
    )
    .orderBy(['questions_evaluation.ordre', 'question_items_evaluation.ordre']);
}

// Postes déclarés au bloc 'disponibilites' du formulaire d'inscription (JSONB, voir
// dossier_donnees_formulaire, migration 013) — sert à valider côté serveur qu'un posteCode reçu
// du front correspond bien à un poste réellement déclaré pour ce dossier, jamais de confiance
// dans ce qu'un client déclare (voir evaluationEngine.enregistrerEvaluation/listerQuestionnaire).
async function trouverPostesDossier(bd, dossierId) {
  const ligne = await bd('dossier_donnees_formulaire')
    .where({ dossier_id: dossierId, bloc_code: 'disponibilites' })
    .first();
  const donnees = ligne?.donnees ?? {};
  return {
    posteBureau: donnees.posteBureau ?? [],
    posteHotel: donnees.posteHotel ?? [],
  };
}

async function enregistrerEvaluation(bd, { dossierId, rendezvousId, formateurId, resultatGlobal, orientation, commentaire }) {
  // Le(s) poste(s) effectivement évalués vivent désormais dans evaluations_postes (migration 040,
  // un bloc pouvant en empiler plusieurs sous un même verdict) — plus de colonne poste_code
  // renseignée ici, voir enregistrerPostesEvaluation ci-dessous.
  const [evaluation] = await bd('evaluations')
    .insert({
      dossier_id: dossierId,
      rendezvous_id: rendezvousId,
      formateur_id: formateurId,
      resultat_global: resultatGlobal,
      orientation: orientation ?? null,
      commentaire,
    })
    .returning('id');
  return evaluation.id;
}

// Un poste évalué = une ligne (evaluations_postes, migration 040) — posteCodes ne contient que
// les postes réellement résolus par bloc (toujours résolus/validés côté serveur,
// evaluationEngine.resoudrePosteCode, jamais la valeur brute envoyée par le client) ; un bloc
// générique (posteCode null) n'a pas de ligne ici, même sémantique que l'ancienne colonne
// evaluations.poste_code NULL.
function enregistrerPostesEvaluation(bd, evaluationId, posteCodes) {
  if (posteCodes.length === 0) return Promise.resolve();
  return bd('evaluations_postes').insert(
    posteCodes.map((posteCode) => ({ evaluation_id: evaluationId, poste_code: posteCode })),
  );
}

// reponses : [{ questionId, questionItemId, valeur }] — un insert groupé plutôt qu'une par
// réponse, le questionnaire entier est validé avant d'écrire quoi que ce soit (voir
// evaluationEngine.enregistrerEvaluation). questionItemId absent (undefined) pour une question
// texte_libre, convertie ici en null (colonne nullable, voir migration 037).
function enregistrerReponses(bd, evaluationId, reponses) {
  return bd('evaluation_reponses').insert(
    reponses.map(({ questionId, questionItemId, valeur }) => ({
      evaluation_id: evaluationId,
      question_id: questionId,
      question_item_id: questionItemId ?? null,
      valeur,
    })),
  );
}

module.exports = {
  trouverQuestionnairePourPoste,
  listerQuestionsAvecItems,
  listerRendezvousAEvaluer,
  trouverEvaluationParRendezvous,
  trouverPostesDossier,
  enregistrerEvaluation,
  enregistrerPostesEvaluation,
  enregistrerReponses,
  listerEvaluationsParFormateur,
  trouverEvaluationParId,
  listerReponsesEvaluation,
};
