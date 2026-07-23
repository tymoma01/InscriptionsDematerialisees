import api from './api';

// Service dédié à la liste des formateurs — encapsule l'appel réseau pour que la modale de
// planification de test n'ait pas à connaître la forme exacte de l'API back-end (même principe
// que les autres services). Distinct de utilisateurService.js (écran de gestion des comptes,
// admin uniquement) : /api/formateurs est accessible à Accueil/Coordination et Recruteur.
export async function listerFormateurs() {
  const { data } = await api.get('/formateurs');
  return data;
}
