import api from './api';

// Service dédié aux relances — encapsule les appels réseau pour que HistoriqueRelances.jsx
// n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// pieceJustificativeService.js).

export async function listerRelances(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/relances`);
  return data;
}

// utilisateurId n'est jamais envoyé ici : le back le dérive de la session serveur de l'agent
// connecté (voir backend/src/api/routes/relances.routes.js), jamais un champ manuel.
export async function enregistrerRelance(dossierId, { canal, resultat }) {
  const { data } = await api.post(`/dossiers/${dossierId}/relances`, { canal, resultat });
  return data;
}

// Résultats de relance configurés pour l'entité courante (table `motifs`) — sert à construire le
// menu déroulant du formulaire sans coder de code en dur côté front (voir Modularité, CLAUDE.md).
export async function listerMotifsResultatRelance() {
  const { data } = await api.get('/dossiers/relances/motifs-resultat');
  return data;
}
