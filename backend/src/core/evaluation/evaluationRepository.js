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
// dossiers.statut_id = 'test_planifie' en plus (workflow v2) : un rendez-vous existe toujours
// après que son dossier soit passé à test_non_realise (voir evaluationEngine.enregistrerEvaluation
// / ListeEvaluationsAFaire.jsx, bouton "Test non réalisé") — sans ce filtre, ce même rendez-vous
// resterait affiché comme "à évaluer" alors que la seule action possible dessus a déjà été prise.
//
// Jointure gauche vers dossier_donnees_formulaire (bloc 'disponibilites', JSONB, migration 013)
// pour exposer le(s) poste(s) recherché(s) — nécessaire pour charger le bon questionnaire côté
// front (voir GrilleEvaluation.jsx), même patron que rendezvousRepository.trouverCoordonneesCandidat.
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
      'statuts.code': 'test_planifie',
    })
    .whereIn('rendezvous.statut', ['prevu', 'confirme'])
    .whereNotExists(function () {
      this.select(1).from('evaluations').whereRaw('evaluations.rendezvous_id = rendezvous.id');
    })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.date_heure',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      'bloc_disponibilites.donnees as donnees_disponibilites',
    )
    .orderBy('rendezvous.date_heure', 'asc');
}

function trouverEvaluationParRendezvous(bd, rendezvousId) {
  return bd('evaluations').where({ rendezvous_id: rendezvousId }).first();
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

async function enregistrerEvaluation(bd, { dossierId, rendezvousId, formateurId, resultatGlobal, orientation, posteCode, commentaire }) {
  const [evaluation] = await bd('evaluations')
    .insert({
      dossier_id: dossierId,
      rendezvous_id: rendezvousId,
      formateur_id: formateurId,
      resultat_global: resultatGlobal,
      orientation: orientation ?? null,
      // Poste effectivement évalué (voir migration 038) — null pour un repli sur le
      // questionnaire générique (dossier bureau, ou poste hôtel sans questionnaire dédié).
      // Toujours le poste résolu/validé côté serveur (evaluationEngine.resoudrePosteCode),
      // jamais la valeur brute envoyée par le client.
      poste_code: posteCode ?? null,
      commentaire,
    })
    .returning('id');
  return evaluation.id;
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
  enregistrerReponses,
};
