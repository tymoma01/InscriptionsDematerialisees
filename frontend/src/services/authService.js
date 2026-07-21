import api from './api';

// Service dédié à la session — encapsule l'appel réseau pour que les composants n'aient pas
// à connaître la forme exacte de l'API back-end (même principe que candidatService.js).

// Retourne null si aucune session n'est active (401), plutôt que de laisser l'erreur remonter :
// « pas connecté » est un résultat normal à ce point d'entrée, pas une panne réseau.
export async function recupererSessionCourante() {
  try {
    const { data } = await api.get('/auth/moi');
    return data.utilisateur;
  } catch (erreur) {
    if (erreur.response?.status === 401) return null;
    throw erreur;
  }
}

// Retourne null sur identifiants invalides (401) plutôt que de laisser l'erreur remonter :
// LoginForm.jsx affiche alors un message générique, jamais "email inconnu" vs "mot de passe
// incorrect" (voir backend/src/api/routes/auth.routes.js, même principe anti-énumération).
export async function seConnecter({ email, motDePasse }) {
  try {
    const { data } = await api.post('/auth/connexion', { email, motDePasse });
    return data.utilisateur;
  } catch (erreur) {
    if (erreur.response?.status === 401) return null;
    throw erreur;
  }
}

export async function seDeconnecter() {
  await api.post('/auth/deconnexion');
}
