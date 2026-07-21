const allMySmsProvider = require('./allMySmsProvider');

/**
 * Sélectionne l'implémentation NotificationProvider à utiliser — un seul prestataire aujourd'hui
 * (AllMySMS, voir docs/architecture-technique.md §3.3), mais ce point d'indirection existe pour
 * qu'un futur changement de prestataire SMS/email ne modifie que ce fichier, même principe que
 * storageFactory.js pour le stockage documentaire. Aucun module de `core/` ne doit importer
 * `allMySmsProvider` directement — toujours passer par cette factory (voir
 * docs/architecture-technique.md §3.4 : "un grep de allmysms dans core/ doit renvoyer zéro
 * résultat").
 */
function notificationFactory() {
  return allMySmsProvider;
}

module.exports = notificationFactory;
