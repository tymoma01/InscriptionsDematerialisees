import api from './api';

// Service dédié aux notifications internes (cloche back-office, NotificationsCloche.jsx) —
// distinct de tout envoi SMS/email candidat, purement in-app, même principe que dpaeService.js.

export async function listerNotifications() {
  const { data } = await api.get('/notifications');
  return data;
}

export async function compterNotificationsNonLues() {
  const { data } = await api.get('/notifications/compteur');
  return data.total;
}

export async function marquerNotificationLue(id) {
  await api.patch(`/notifications/${id}/lue`);
}

export async function marquerToutesNotificationsLues() {
  await api.patch('/notifications/tout-lire');
}
