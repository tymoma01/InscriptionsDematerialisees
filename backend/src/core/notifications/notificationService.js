// Notifications internes génériques (module Demandes DPAE, 2026-09-28) — volontairement distinct
// de integrations/notifications/notificationFactory.js (SMS/email adressés au candidat) : celui-ci
// ne notifie qu'un agent interne (utilisateurs), purement in-app, aucun envoi externe déclenché.
// Reste générique (table_cible/cible_id, voir migration 067) pour être réutilisable par un futur
// type de notification que la DPAE, même si seule celle-ci l'utilise aujourd'hui.

const db = require('../../db/knex');
const notificationRepository = require('./notificationRepository');

async function creerNotifications(bd, notifications) {
  return notificationRepository.creerNotifications(bd, notifications);
}

async function listerPourUtilisateur(utilisateurId) {
  const bd = await db.obtenirKnex();
  return notificationRepository.listerPourUtilisateur(bd, utilisateurId);
}

async function compterNonLues(utilisateurId) {
  const bd = await db.obtenirKnex();
  const { total } = await notificationRepository.compterNonLues(bd, utilisateurId);
  return Number(total);
}

async function marquerLue(utilisateurId, id) {
  const bd = await db.obtenirKnex();
  return notificationRepository.marquerLue(bd, utilisateurId, id);
}

async function marquerToutesLues(utilisateurId) {
  const bd = await db.obtenirKnex();
  return notificationRepository.marquerToutesLues(bd, utilisateurId);
}

module.exports = {
  creerNotifications,
  listerPourUtilisateur,
  compterNonLues,
  marquerLue,
  marquerToutesLues,
};
