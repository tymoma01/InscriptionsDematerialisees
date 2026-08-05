const allMySmsProvider = require('./allMySmsProvider');
const graphMailProvider = require('./graphMailProvider');

/**
 * Sélectionne l'implémentation NotificationProvider à utiliser selon le canal — AllMySMS pour
 * 'sms', Microsoft Graph pour 'email' (AllMySMS ne propose pas d'envoi d'email réel : leur seul
 * service proche, Mail2SMS, fait l'inverse, voir docs/architecture-technique.md §3.3, décision du
 * 2026-08-05). Les deux prestataires restent derrière la même interface NotificationProvider, donc
 * masqués par ce seul point d'indirection — même principe que storageFactory.js pour le stockage
 * documentaire. Chaque appelant (invitationTestService.js, relanceService.js, rappelService.js)
 * appelle `notificationFactory()` une seule fois puis `.envoyer(destinataire, canal, ...)` avec un
 * `canal` qui varie d'un appel à l'autre — l'objet renvoyé doit donc lui-même dispatcher par canal,
 * pas l'appelant. Aucun module de `core/` ne doit importer `allMySmsProvider`/`graphMailProvider`
 * directement — toujours passer par cette factory (voir docs/architecture-technique.md §3.4 : "un
 * grep de allmysms/graph dans core/ doit renvoyer zéro résultat").
 */
function notificationFactory() {
  return {
    envoyer(destinataire, canal, message, options = {}) {
      const provider = canal === 'email' ? graphMailProvider : allMySmsProvider;
      return provider.envoyer(destinataire, canal, message, options);
    },
  };
}

module.exports = notificationFactory;
