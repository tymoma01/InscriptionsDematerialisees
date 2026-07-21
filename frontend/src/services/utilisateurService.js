import api from './api';

// Service dédié à la gestion des comptes (écran admin) — encapsule les appels réseau pour que
// Utilisateurs.jsx n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// les autres services).

export async function listerUtilisateurs() {
  const { data } = await api.get('/utilisateurs');
  return data;
}

// Rôles assignables configurés côté serveur (systeme exclu) — sert à construire le sélecteur du
// formulaire sans coder de code de rôle en dur côté front (voir Modularité, CLAUDE.md).
export async function listerRolesAssignables() {
  const { data } = await api.get('/utilisateurs/roles');
  return data;
}

export async function creerUtilisateur(donnees) {
  const { data } = await api.post('/utilisateurs', donnees);
  return data;
}

export async function mettreAJourUtilisateur(id, donnees) {
  const { data } = await api.patch(`/utilisateurs/${id}`, donnees);
  return data;
}
