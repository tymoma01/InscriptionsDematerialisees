import api from './api';

// Référentiel des sites d'affectation des demandes DPAE (backend sitesAffectation.routes.js,
// migration 069) — même principe que les autres services : les composants ne connaissent pas la
// forme exacte de l'API.

// Sites actifs de l'entité, triés par nom : [{ id, nom, initiales }].
export async function listerSitesAffectation({ secteur } = {}) {
  const { data } = await api.get('/sites-affectation', { params: secteur ? { secteur } : undefined });
  return data;
}

// Ajout d'un site (bouton « + » du formulaire DPAE). Renvoie le site créé { id, nom, initiales } ;
// un doublon (409) ou un format invalide (400) remonte en erreur, avec le message du serveur dans
// erreur.response.data.erreur (et le détail par champ dans .details pour un 400).
export async function creerSiteAffectation({ nom, initiales }) {
  const { data } = await api.post('/sites-affectation', { nom, initiales });
  return data;
}

// --- Sites du Tertiaire ---------------------------------------------------------------------------------
// La liste et la création suivent le secteur du rôle (le serveur le détermine) ; l'Admin passe `secteur`.

// Création d'un site du Tertiaire : nom (obligatoire) et adresse (facultative). Un nom identique ou proche
// d'un site existant renvoie 409 avec `sitesProches` ; `confirmerProche` passe outre un nom seulement proche.
export async function creerSiteTertiaire({ nom, adresse, confirmerProche = false, secteur }) {
  const { data } = await api.post('/sites-affectation', { nom, adresse, confirmerProche }, { params: secteur ? { secteur } : undefined });
  return data;
}

// Renommage d'un site du Tertiaire depuis la sélection des sites (Planning Tertiaire, Admin). Un nom identique ou
// très proche d'un autre site renvoie 409, un profil non habilité 403, avec le message du serveur.
export async function renommerSiteTertiaire(siteId, nom) {
  const { data } = await api.patch(`/sites-affectation/${siteId}`, { nom });
  return data;
}
