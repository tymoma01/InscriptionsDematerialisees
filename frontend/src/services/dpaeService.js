import api from './api';

// Service dédié au module Demandes DPAE — encapsule les appels réseau pour que les pages
// (DemandeDpae.jsx, SuiviDemandesDpae.jsx, TraitementDpae.jsx, DetailDemandeDpae.jsx) n'aient pas
// à connaître la forme exacte de l'API back-end, même principe que relanceService.js.

// demandeurId n'est jamais envoyé ici : le back le dérive de la session serveur de l'agent
// connecté (voir backend/src/api/routes/dpae.routes.js), jamais un champ manuel.
export async function creerDemande(demande) {
  const { data } = await api.post('/dpae', demande);
  return data;
}

// Liste de la page « Suivi des demandes DPAE » (2026-09-30, remplace GET /dpae/mes-demandes) —
// perimetre 'toutes' | 'mes' ; le serveur décide du périmètre effectif selon le rôle (seuls Admin
// et RH obtiennent 'toutes'), voir dpae.routes.js GET /suivi. Chaque demande porte
// sites_affectation ([] pour une demande antérieure au référentiel, qui garde son texte `hotel`).
export async function listerSuiviDemandes(perimetre) {
  const { data } = await api.get('/dpae/suivi', { params: perimetre ? { perimetre } : undefined });
  return data;
}

// statut par défaut côté back : 'envoyee' (file à traiter) — passer 'tous' pour l'historique
// complet (traitées incluses), voir dpae.routes.js.
export async function listerDemandesRh(statut) {
  const { data } = await api.get('/dpae', { params: statut ? { statut } : undefined });
  return data;
}

export async function obtenirDemande(demandeId) {
  const { data } = await api.get(`/dpae/${demandeId}`);
  return data;
}

export async function validerDemande(demandeId) {
  await api.patch(`/dpae/${demandeId}/valider`);
}

export async function rejeterDemande(demandeId, motifRejet) {
  await api.patch(`/dpae/${demandeId}/rejeter`, { motifRejet });
}

// Autocomplétion "nom du salarié" (RechercheCandidatSalarie.jsx) — texte trop court ignoré côté
// back (voir dossierService.rechercherCandidats), pas la peine de dupliquer ce seuil ici.
export async function rechercherCandidats(texte) {
  const { data } = await api.get('/candidats/recherche', { params: { q: texte } });
  return data;
}

// « Tableau de bord DPAE » (2026-09-30) — indicateurs calculés côté serveur (dpae.routes.js,
// GET /tableau-de-bord), entité courante. filtres : { debut, fin, siteId, typeContrat, statut },
// tous optionnels (valeur vide = tous ; période par défaut : les 30 derniers jours).
export async function obtenirTableauDeBordDpae(filtres = {}) {
  const params = Object.fromEntries(Object.entries(filtres).filter(([, valeur]) => valeur !== '' && valeur !== undefined && valeur !== null));
  const { data } = await api.get('/dpae/tableau-de-bord', { params });
  return data;
}
