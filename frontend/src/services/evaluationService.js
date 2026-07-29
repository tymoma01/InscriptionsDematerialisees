import api from './api';

// Service dédié à l'évaluation du test — encapsule les appels réseau pour que les composants de
// core/evaluation/ n'aient pas à connaître la forme exacte de l'API back-end (même principe que
// relanceService.js / rendezvousService.js).

export async function listerCriteres() {
  const { data } = await api.get('/evaluations/criteres');
  return data;
}

// Déjà filtrée par le formateur connecté côté serveur (voir backend evaluations.routes.js) —
// jamais de formateurId envoyé ici.
export async function listerRendezvousAEvaluer() {
  const { data } = await api.get('/evaluations/a-faire');
  return data;
}

export async function enregistrerEvaluation({ rendezvousId, resultatGlobal, orientation, commentaire, criteres }) {
  const { data } = await api.post('/evaluations', { rendezvousId, resultatGlobal, orientation, commentaire, criteres });
  return data;
}
