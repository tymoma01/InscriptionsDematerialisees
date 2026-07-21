import api from './api';

// Service dédié aux dossiers — encapsule les appels réseau pour que TableauDeBordAccueil.jsx
// n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// pieceJustificativeService.js).

export async function listerDossiers({ statut } = {}) {
  const { data } = await api.get('/dossiers', { params: statut ? { statut } : {} });
  return data;
}

// Statuts configurés pour l'entité courante, dans l'ordre du workflow — sert à construire les
// filtres du tableau de bord sans coder de code de statut en dur côté front (voir Modularité,
// CLAUDE.md).
export async function listerStatuts() {
  const { data } = await api.get('/dossiers/statuts');
  return data;
}
