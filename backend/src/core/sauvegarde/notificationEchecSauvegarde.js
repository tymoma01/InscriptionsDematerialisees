const notificationFactory = require('../../integrations/notifications/notificationFactory');
const env = require('../../config/env');

/**
 * Alerte en cas d'échec de la sauvegarde quotidienne Neon — sans ce filet, un échec pourrait
 * passer inaperçu pendant des semaines (jusqu'au jour où une restauration s'avère nécessaire),
 * voir spécification du job dans docs/sauvegarde-neon.md.
 *
 * Ne lève jamais : un échec d'envoi de la notification elle-même (Graph indisponible, adresse mal
 * configurée...) ne doit pas masquer l'erreur d'origine ni faire planter le script — l'échec de
 * notification est simplement loggué, l'échec de sauvegarde reste de toute façon visible via le
 * code de sortie non-zéro du script (voir scripts/sauvegarderNeon.js) et les logs eux-mêmes.
 */
async function notifierEchecSauvegarde(erreur) {
  if (!env.SAUVEGARDE_EMAIL_ALERTE) {
    console.error(
      "Aucune adresse d'alerte configurée (SAUVEGARDE_EMAIL_ALERTE) : notification d'échec de sauvegarde non envoyée.",
    );
    return;
  }

  try {
    await notificationFactory().envoyer(
      env.SAUVEGARDE_EMAIL_ALERTE,
      'email',
      `La sauvegarde quotidienne de la base Neon a échoué le ${new Date().toISOString()}.\n\n` +
        `Détail de l'erreur :\n${erreur.message}\n\n` +
        `Le PITR natif Neon reste disponible mais limité à 6h sur le plan gratuit — une intervention rapide est recommandée si l'échec se répète.`,
      { sujet: '[ACCECIT] Échec de la sauvegarde quotidienne Neon' },
    );
  } catch (erreurNotification) {
    console.error("Échec de l'envoi de la notification d'échec de sauvegarde (en plus de l'échec de sauvegarde lui-même) :");
    console.error(erreurNotification.message);
  }
}

module.exports = { notifierEchecSauvegarde };
