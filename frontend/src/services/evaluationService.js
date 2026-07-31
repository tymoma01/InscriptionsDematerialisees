import api from './api';

// Service dédié à l'évaluation du test — encapsule les appels réseau pour que les composants de
// core/evaluation/ n'aient pas à connaître la forme exacte de l'API back-end (même principe que
// relanceService.js / rendezvousService.js).

// Questionnaire résolu pour le poste donné (repli générique côté serveur si aucun questionnaire
// dédié n'existe pour ce poste, voir backend evaluationEngine.listerQuestionnaire) — posteCode
// omis si le dossier n'a aucun poste déclaré.
export async function obtenirQuestionnaire({ rendezvousId, posteCode }) {
  const { data } = await api.get('/evaluations/questionnaire', { params: { rendezvousId, posteCode } });
  return data;
}

// Déjà filtrée par le formateur connecté côté serveur (voir backend evaluations.routes.js) —
// jamais de formateurId envoyé ici.
export async function listerRendezvousAEvaluer() {
  const { data } = await api.get('/evaluations/a-faire');
  return data;
}

// blocs : [{ posteCode, reponses }] — un bloc par poste évalué (questionnaires empilés, voir
// GrilleEvaluation.jsx), un seul verdict global (resultatGlobal/orientation/commentaire) pour
// l'ensemble.
export async function enregistrerEvaluation({ rendezvousId, resultatGlobal, orientation, commentaire, blocs }) {
  const { data } = await api.post('/evaluations', {
    rendezvousId,
    resultatGlobal,
    orientation,
    commentaire,
    blocs,
  });
  return data;
}

// Évaluations déjà soumises par le formateur connecté — jamais tous formateurs confondus (voir
// backend evaluationEngine.listerHistorique), même principe que listerRendezvousAEvaluer ci-dessus.
export async function listerHistoriqueEvaluations() {
  const { data } = await api.get('/evaluations/historique');
  return data;
}

// Détail en lecture seule d'une évaluation déjà soumise (voir DetailEvaluation.jsx) — l'appartenance
// au formateur connecté est revérifiée côté serveur, pas seulement supposée parce que l'id vient
// de sa propre liste d'historique.
export async function obtenirDetailEvaluation(evaluationId) {
  const { data } = await api.get(`/evaluations/historique/${evaluationId}`);
  return data;
}
