// Accès données pour l'évaluation du test — uniquement des requêtes, aucune règle métier ici
// (orchestrée par evaluationEngine.js), même découpage que dossierRepository.js.

// Critères configurés pour l'entité, dans l'ordre de la grille (colonne `ordre`) — propres à
// chaque entité (CLAUDE.md, Modularité : "les critères d'évaluation du test" varient par entité),
// jamais nommés en dur ici (voir docs/architecture-technique.md §1.5).
function listerCriteres(bd, entiteId) {
  return bd('criteres_evaluation').where({ entite_id: entiteId }).orderBy('ordre', 'asc');
}

function trouverCritereParCode(bd, entiteId, code) {
  return bd('criteres_evaluation').where({ entite_id: entiteId, code }).first();
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
function listerRendezvousAEvaluer(bd, entiteId, formateurId) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
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
    )
    .orderBy('rendezvous.date_heure', 'asc');
}

function trouverEvaluationParRendezvous(bd, rendezvousId) {
  return bd('evaluations').where({ rendezvous_id: rendezvousId }).first();
}

async function enregistrerEvaluation(bd, { dossierId, rendezvousId, formateurId, resultatGlobal, orientation, commentaire }) {
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

function enregistrerResultatsCriteres(bd, evaluationId, resultats) {
  // resultats : [{ critereId, valeur }] — un insert groupé plutôt qu'un par critère, la grille
  // entière est validée avant d'écrire quoi que ce soit (voir evaluationEngine.enregistrerEvaluation).
  return bd('evaluation_resultats').insert(
    resultats.map(({ critereId, valeur }) => ({ evaluation_id: evaluationId, critere_id: critereId, valeur })),
  );
}

module.exports = {
  listerCriteres,
  trouverCritereParCode,
  listerRendezvousAEvaluer,
  trouverEvaluationParRendezvous,
  enregistrerEvaluation,
  enregistrerResultatsCriteres,
};
