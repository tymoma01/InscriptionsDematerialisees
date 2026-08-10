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
