import api from './api';

// Service dédié à la machine à états des dossiers — encapsule les appels réseau pour que
// GestionTransitions.jsx n'ait pas à connaître la forme exacte de l'API back-end (même principe
// que relanceService.js / rendezvousService.js).

// Déjà filtrée par rôle côté serveur (voir backend workflowEngine.listerTransitionsDisponibles) :
// une liste vide signifie "rien à faire pour ce rôle depuis ce statut", pas une erreur.
export async function listerTransitions(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/transitions`);
  return data;
}

// utilisateurId n'est jamais envoyé ici : le back le dérive de la session serveur de l'agent
// connecté (voir backend/src/api/routes/transitions.routes.js), jamais un champ manuel.
export async function appliquerTransition(dossierId, { codeAction, motifCode, commentaire }) {
  const { data } = await api.post(`/dossiers/${dossierId}/transitions`, { codeAction, motifCode, commentaire });
  return data;
}

// Motifs configurés pour une action donnée — sert à construire le sélecteur de motif sans coder
// de code en dur côté front (voir Modularité, CLAUDE.md).
export async function listerMotifsPourAction(codeAction) {
  const { data } = await api.get('/dossiers/transitions/motifs', { params: { codeAction } });
  return data;
}
