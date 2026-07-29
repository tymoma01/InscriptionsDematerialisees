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

export async function enregistrerEvaluation({ rendezvousId, resultatGlobal, orientation, posteCode, commentaire, reponses }) {
  const { data } = await api.post('/evaluations', {
    rendezvousId,
    resultatGlobal,
    orientation,
    posteCode,
    commentaire,
    reponses,
  });
  return data;
}
