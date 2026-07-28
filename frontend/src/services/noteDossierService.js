import api from './api';

// Service dédié au journal de notes d'un dossier — encapsule les appels réseau pour que
// NotesDossier.jsx n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// relanceService.js).

export async function listerNotesDossier(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/notes`);
  return data;
}

// auteurId n'est jamais envoyé ici : le back le dérive de la session serveur de l'agent connecté
// (voir backend/src/api/routes/notes.routes.js), jamais un champ manuel.
export async function ajouterNoteDossier(dossierId, { contenu }) {
  const { data } = await api.post(`/dossiers/${dossierId}/notes`, { contenu });
  return data;
}
