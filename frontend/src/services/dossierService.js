import api from './api';

// Service dédié aux dossiers — encapsule les appels réseau pour que TableauDeBordAccueil.jsx
// n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// pieceJustificativeService.js).

export async function listerDossiers({ statut } = {}) {
  const { data } = await api.get('/dossiers', { params: statut ? { statut } : {} });
  return data;
}

// Statuts configurés pour l'entité courante, dans l'ordre du workflow — sert à construire les
// filtres du tableau de bord sans coder de code de statut en dur côté front (voir Modularité,
// CLAUDE.md).
export async function listerStatuts() {
  const { data } = await api.get('/dossiers/statuts');
  return data;
}

// Un seul dossier (statut + nom/prénom du candidat déjà joints côté back) — sert par exemple à
// afficher le nom du candidat en en-tête de l'écran de capture de pièces (CaptureTablette.jsx).
export async function obtenirDossier(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}`);
  return data;
}

// Candidat (hors NIR) + tous les blocs du formulaire d'inscription — section repliable
// "Informations d'inscription complètes" de la fiche dossier (voir InformationsInscription.jsx).
export async function obtenirInscriptionComplete(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/inscription`);
  return data;
}
