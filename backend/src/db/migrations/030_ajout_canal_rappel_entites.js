// Ajoute `canal_rappel` sur `entites` — canal ('sms' | 'email') utilisé pour le rappel
// automatique de créneau (CLAUDE.md, besoin Accueil/Coordination "rappel automatique... pour
// réduire les désistements"). Une entité choisit son canal comme elle choisit déjà son
// connecteur de stockage (`entites.connecteur_stockage`) — chaîne simple, pas de table dédiée
// pour deux valeurs possibles (voir Modularité, CLAUDE.md), validée côté application (voir
// core/rendezvous/rappelService.js), pas de CHECK ici (même choix que connecteur_stockage,
// migration 001, aucune contrainte SQL sur les valeurs possibles).
// L'envoi lui-même reste conditionné à `entites.sms_actif` (déjà existant, migration 001) : sans
// ce flag, le moteur n'invoque jamais le prestataire de notification, quel que soit canal_rappel
// (voir docs/architecture-technique.md §3.3).
exports.up = (knex) =>
  knex.schema.alterTable('entites', (table) => {
    table.string('canal_rappel').notNullable().defaultTo('sms');
  });

exports.down = (knex) =>
  knex.schema.alterTable('entites', (table) => {
    table.dropColumn('canal_rappel');
  });
