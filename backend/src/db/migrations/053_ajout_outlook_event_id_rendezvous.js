// Id de l'événement Microsoft Graph créé sur le calendrier départemental partagé
// (formation@accecit.com pour les tests Formateur, tertiaire2@accecit.com pour les tests
// Inspecteur — voir graphCalendarService.js) au moment de la planification d'un test.
// Nullable : reste vide pour tout rendez-vous sans formateur/inspecteur assigné (ex.
// signature_contrat, voir rendezvousService.creerRendezvous), et pour les rendez-vous créés avant
// ce chantier (colonne rétroactivement vide, jamais recalculée). Sert à deux choses : (1) libérer
// le créneau Outlook réel via DELETE .../events/{id} quand ce rendez-vous est neutralisé lors
// d'une replanification (voir rendezvousService.creerRendezvous, corrige la fuite identifiée à
// l'audit du 2026-08-26 — l'ancien évènement restait sinon marqué "occupé" indéfiniment côté
// Outlook), (2) tracer, pour un diagnostic manuel, quel événement Graph correspond à quelle ligne
// `rendezvous`.
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.string('outlook_event_id').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('outlook_event_id');
  });
