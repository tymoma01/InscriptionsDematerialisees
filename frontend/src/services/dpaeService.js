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

// Téléchargement PDF — PDF généré côté serveur. Réponse axios complète (pas seulement
// data) : le nom du fichier vient de l'en-tête Content-Disposition. Enregistrement et messages
// d'erreur : core/dpae/TelechargementPdfDpae.jsx.
export function telechargerPdfDemande(demandeId) {
  return api.get(`/dpae/${demandeId}/pdf`, { responseType: 'blob' });
}

// ZIP d'un PDF par demande — 50 demandes au plus (refusé au-delà par le serveur, 400).
export function telechargerPdfDemandes(demandeIds) {
  return api.post('/dpae/export-pdf', { demandeIds }, { responseType: 'blob' });
}

export async function validerDemande(demandeId) {
  await api.patch(`/dpae/${demandeId}/valider`);
}

export async function rejeterDemande(demandeId, motifRejet) {
  await api.patch(`/dpae/${demandeId}/rejeter`, { motifRejet });
}

// « À traiter » -> « En attente », motif obligatoire (refusé sinon côté serveur).
export async function mettreEnAttenteDemande(demandeId, motif) {
  await api.patch(`/dpae/${demandeId}/mettre-en-attente`, { motif });
}

// Notes propres à une demande — même forme de réponse que les notes d'un dossier
// (noteDossierService.js), affichées par le même composant NotesDossier.jsx. auteurId jamais
// envoyé : le back le prend de la session.
export async function listerNotesDemande(demandeId) {
  const { data } = await api.get(`/dpae/${demandeId}/notes`);
  return data;
}

export async function ajouterNoteDemande(demandeId, { contenu }) {
  const { data } = await api.post(`/dpae/${demandeId}/notes`, { contenu });
  return data;
}

// Autocomplétion "nom du salarié" (RechercheCandidatSalarie.jsx) — texte trop court ignoré côté
// back (voir dossierService.rechercherCandidats), pas la peine de dupliquer ce seuil ici.
export async function rechercherCandidats(texte) {
  const { data } = await api.get('/candidats/recherche', { params: { q: texte } });
  return data;
}

// « Tableau de bord DPAE » — indicateurs calculés côté serveur (dpae.routes.js,
// GET /tableau-de-bord), entité courante. filtres : { debut, fin, siteId, typeContrat, statut },
// tous optionnels (valeur vide = tous ; période par défaut : les 30 derniers jours).
export async function obtenirTableauDeBordDpae(filtres = {}) {
  const params = Object.fromEntries(Object.entries(filtres).filter(([, valeur]) => valeur !== '' && valeur !== undefined && valeur !== null));
  const { data } = await api.get('/dpae/tableau-de-bord', { params });
  return data;
}
