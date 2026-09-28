// Accès données pour les notifications internes — uniquement des requêtes, aucune règle métier ici
// (orchestrée par notificationService.js), même découpage que le reste du projet.

function creerNotifications(trx, notifications) {
  if (notifications.length === 0) return Promise.resolve();
  return trx('notifications').insert(
    notifications.map((notification) => ({
      entite_id: notification.entiteId,
      utilisateur_id: notification.utilisateurId,
      type: notification.type,
      table_cible: notification.tableCible,
      cible_id: notification.cibleId,
      message: notification.message,
      lien: notification.lien || null,
    })),
  );
}

// limite fixe côté back (pas de pagination pour ce premier jet, voir NotificationsCloche.jsx —
// simple liste déroulante, pas un centre de notifications paginé).
function listerPourUtilisateur(trx, utilisateurId, limite = 20) {
  return trx('notifications').where({ utilisateur_id: utilisateurId }).orderBy('date_creation', 'desc').limit(limite);
}

function compterNonLues(trx, utilisateurId) {
  return trx('notifications').where({ utilisateur_id: utilisateurId, lue: false }).count({ total: '*' }).first();
}

// utilisateurId dans le WHERE (pas seulement l'id de la notification) : empêche un utilisateur de
// marquer comme lue la notification d'un autre en devinant son id (IDOR), même principe que
// vérifierDossierAppartientEntite ailleurs dans le projet.
function marquerLue(trx, utilisateurId, id) {
  return trx('notifications').where({ id, utilisateur_id: utilisateurId }).update({ lue: true, date_lecture: trx.fn.now() });
}

function marquerToutesLues(trx, utilisateurId) {
  return trx('notifications')
    .where({ utilisateur_id: utilisateurId, lue: false })
    .update({ lue: true, date_lecture: trx.fn.now() });
}

module.exports = {
  creerNotifications,
  listerPourUtilisateur,
  compterNonLues,
  marquerLue,
  marquerToutesLues,
};
