import api from './api';

// Service dédié à la liste des lieux de test — encapsule l'appel réseau pour que la modale de
// planification de test n'ait pas à connaître la forme exacte de l'API back-end (même principe
// que formateurService.js).
export async function listerLieux() {
  const { data } = await api.get('/lieux');
  return data;
}
