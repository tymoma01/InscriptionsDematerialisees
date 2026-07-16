import api from './api';

// Service dédié à l'inscription des candidats — encapsule l'appel réseau pour que
// le formulaire n'ait pas à connaître la forme exacte de l'API back-end.
export async function creerCandidat(candidat) {
  const { data } = await api.post('/candidats', candidat);
  return data;
}
