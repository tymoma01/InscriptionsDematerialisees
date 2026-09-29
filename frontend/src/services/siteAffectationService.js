import api from './api';

// Référentiel des sites d'affectation des demandes DPAE (backend sitesAffectation.routes.js,
// migration 069) — même principe que les autres services : les composants ne connaissent pas la
// forme exacte de l'API.

// Sites actifs de l'entité, triés par nom : [{ id, nom, initiales }].
export async function listerSitesAffectation() {
  const { data } = await api.get('/sites-affectation');
  return data;
}

// Ajout d'un site (bouton « + » du formulaire DPAE). Renvoie le site créé { id, nom, initiales } ;
// un doublon (409) ou un format invalide (400) remonte en erreur, avec le message du serveur dans
// erreur.response.data.erreur (et le détail par champ dans .details pour un 400).
export async function creerSiteAffectation({ nom, initiales }) {
  const { data } = await api.post('/sites-affectation', { nom, initiales });
  return data;
}
