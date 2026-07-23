import api from './api';

// Service dédié à l'inscription des candidats — encapsule l'appel réseau pour que
// le formulaire n'ait pas à connaître la forme exacte de l'API back-end.
export async function creerCandidat(candidat) {
  const { data } = await api.post('/candidats', candidat);
  return data;
}

// Vérification ponctuelle d'unicité (NIR ou email), appelée au blur du champ concerné — voir
// BlocInfosPerso.jsx / BlocCoordonnees.jsx. Ne renvoie qu'un booléen : disponible ou déjà utilisé.
export async function verifierDisponibilite(champ, valeur) {
  const { data } = await api.post('/candidats/disponibilite', { champ, valeur });
  return data.disponible;
}
