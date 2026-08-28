import api from './api';

// Self-service "Mon profil" (n'importe quel rôle authentifié, sur SON PROPRE compte) — distinct
// de utilisateurService.js (écran admin, tous comptes de l'entité), voir backend moi.routes.js.

export async function obtenirMonProfil() {
  const { data } = await api.get('/moi');
  return data;
}

// donnees : { telephone? , recevoirEmailPlanification? } — au moins un des deux, voir backend
// (miseAJourProfilSchema, moi.routes.js).
export async function mettreAJourMonProfil(donnees) {
  const { data } = await api.patch('/moi', donnees);
  return data;
}
