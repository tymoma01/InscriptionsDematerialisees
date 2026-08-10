import api from './api';

// Service dédié à la liste des lieux de test — encapsule l'appel réseau pour que la modale de
// planification de test n'ait pas à connaître la forme exacte de l'API back-end (même principe
// que formateurService.js).
export async function listerLieux() {
  const { data } = await api.get('/lieux');
  return data;
}

// Création à la volée (bouton "+" à côté du sélecteur de lieu, ModalePlanificationTest.jsx) —
// `libelle` porte l'adresse en texte libre, pas de champ adresse séparé (voir lieuService.js
// côté back, table `lieux` sans colonne dédiée). Renvoie le lieu créé ({ id, code, libelle,
// actif }) pour que l'appelant l'ajoute à sa liste locale et le présélectionne sans refetch.
export async function creerLieu({ libelle }) {
  const { data } = await api.post('/lieux', { libelle });
  return data;
}

// Modification à la volée (bouton crayon à côté du sélecteur de lieu, ModalePlanificationTest.jsx)
// — même forme de réponse que creerLieu ci-dessus, pour que l'appelant mette à jour sa liste
// locale sans refetch.
export async function modifierLieu(lieuId, { libelle }) {
  const { data } = await api.patch(`/lieux/${lieuId}`, { libelle });
  return data;
}

// Rendez-vous encore associés à ce lieu (bouton poubelle, ModalePlanificationTest.jsx) — appelé
// avant toute tentative de suppression pour décider entre confirmation simple (tableau vide) et
// panneau de migration (au moins une entrée). Forme : { id, dateHeure, candidatNom,
// candidatPrenom }[] — jamais les coordonnées candidat (email/téléphone), inutiles à cet écran.
export async function listerRendezvousAssociesLieu(lieuId) {
  const { data } = await api.get(`/lieux/${lieuId}/rendezvous`);
  return data;
}

// Suppression d'un lieu — `lieuDestinationId` requis seulement si des rendez-vous y sont encore
// associés (voir listerRendezvousAssociesLieu ci-dessus) ; omis sinon. axios : le corps d'un
// DELETE se passe via `{ data }` dans la config, pas en 2e argument positionnel comme post/patch.
export async function supprimerLieu(lieuId, { lieuDestinationId } = {}) {
  const { data } = await api.delete(`/lieux/${lieuId}`, {
    data: lieuDestinationId ? { lieuDestinationId } : undefined,
  });
  return data;
}
