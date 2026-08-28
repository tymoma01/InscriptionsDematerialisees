// Préférence formateur/inspecteur (écran "Mon profil", audit 2026-08-28) : décoché, l'app
// n'envoie plus l'email personnalisé "Nouveau candidat à évaluer"/"Test replanifié" (.ics + lien
// d'évaluation, voir invitationTestService.construireMessageEmailFormateur) à ce formateur/
// inspecteur précis lors d'une planification le concernant — l'événement Outlook (calendrier
// départemental, voir graphCalendarService.creerEvenement) reste créé normalement, cette
// préférence ne joue que sur l'email. `defaultTo(true)` : comportement actuel inchangé pour tous
// les comptes existants tant qu'ils ne décochent pas explicitement la case.
exports.up = (knex) =>
  knex.schema.alterTable('utilisateurs', (table) => {
    table.boolean('recevoir_email_planification').notNullable().defaultTo(true);
  });

exports.down = (knex) =>
  knex.schema.alterTable('utilisateurs', (table) => {
    table.dropColumn('recevoir_email_planification');
  });
