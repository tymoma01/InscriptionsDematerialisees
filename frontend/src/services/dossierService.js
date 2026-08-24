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

// Signal de rafraîchissement automatique du back-office (audit 2026-08-24, voir
// useRafraichissementAuto.js) — un seul horodatage (ISO), jamais les données elles-mêmes.
export async function obtenirDerniereModification() {
  const { data } = await api.get('/dossiers/derniere-modification');
  return data.derniereModification;
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

// Bouton "Modifier" de cette même section (correction d'une erreur de saisie, réservé à
// Accueil/Coordination et Admin côté back — voir dossiers.routes.js) — renvoie la même forme que
// obtenirInscriptionComplete ci-dessus, pour rafraîchir l'affichage sans second aller-retour.
export async function modifierInscription(dossierId, donnees) {
  const { data } = await api.patch(`/dossiers/${dossierId}/inscription`, donnees);
  return data;
}
