import api from './api';

// Service dédié aux dossiers — encapsule les appels réseau pour que TableauDeBordAccueil.jsx
// n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// pieceJustificativeService.js).

// dispoDebut (audit 2026-09-28, filtre "Disponibilité des candidats prêts à l'embauche" ;
// dispoFin RETIRÉ le même jour, demande utilisateur explicite — un seul paramètre d'entrée, utilisé
// côté back comme date PONCTUELLE ("qui est disponible à cette date précise"), voir
// dossiers.routes.js/dossierRepository.listerDossiers) ; filtrage SERVEUR, contrairement au reste
// des filtres de cette page (recherche/statut/expérience/entité), tous client (voir
// TableauDeBordAccueil.jsx).
export async function listerDossiers({ statut, dispoDebut } = {}) {
  const params = {};
  if (statut) params.statut = statut;
  if (dispoDebut) params.dispoDebut = dispoDebut;
  const { data } = await api.get('/dossiers', { params });
  return data;
}

// Corrige la disponibilité d'un candidat "Validé - prêt à l'embauche" (audit 2026-09-28) — SANS
// écraser la déclaration d'origine du candidat, voir ModaleDisponibiliteEmbauche.jsx/
// backend/disponibiliteEmbaucheService.js.
export async function corrigerDisponibiliteEmbauche(dossierId, { dateDebut, dateFin, commentaire }) {
  const { data } = await api.post(`/dossiers/${dossierId}/disponibilite-embauche`, { dateDebut, dateFin, commentaire });
  return data;
}

// Statuts configurés pour l'entité courante, dans l'ordre du workflow — sert à construire les
// filtres du tableau de bord sans coder de code de statut en dur côté front (voir Modularité,
// CLAUDE.md).
export async function listerStatuts() {
  const { data } = await api.get('/dossiers/statuts');
  return data;
}

// Dossiers "Validé - envoyé en formation" (audit 2026-08-28, écran "Suivi des formations") — le
// statut filtré est fixé côté serveur (voir dossiers.routes.js), jamais un paramètre envoyé ici.
export async function listerSuiviFormation() {
  const { data } = await api.get('/dossiers/suivi-formation');
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

// Historique de formation du dossier (onglet "Formation" de la fiche dossier, audit 2026-08-28) —
// un envoi en formation par entrée, avec son issue éventuelle (Formation validée/non validée).
export async function obtenirHistoriqueFormation(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/formation`);
  return data;
}

// Bouton "Modifier" de cette même section (correction d'une erreur de saisie, réservé à
// Accueil/Coordination et Admin côté back — voir dossiers.routes.js) — renvoie la même forme que
// obtenirInscriptionComplete ci-dessus, pour rafraîchir l'affichage sans second aller-retour.
export async function modifierInscription(dossierId, donnees) {
  const { data } = await api.patch(`/dossiers/${dossierId}/inscription`, donnees);
  return data;
}
