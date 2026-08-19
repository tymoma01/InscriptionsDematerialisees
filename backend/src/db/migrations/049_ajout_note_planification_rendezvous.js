// Note libre optionnelle saisie par l'agent Accueil/Coordination au moment de la planification
// d'un test (ModalePlanificationTest.jsx, "Note pour le formateur/inspecteur") — distincte du
// journal de notes générales du dossier (table notes_dossier, bloc "Notes" de la fiche candidat) :
// celle-ci est propre à CE rendez-vous précis, jamais affichée dans le bloc "Notes" général, et
// remplacée à chaque nouvelle planification/replanification (même comportement que
// postes_selectionnes, migration 039 — pas d'historique des versions successives, seule la note
// du rendez-vous ACTUELLEMENT actif compte). Nullable, sans defaultTo : le champ est optionnel
// côté formulaire, contrairement à postes_selectionnes qui a toujours une valeur (même vide).
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.text('note_planification').nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('note_planification');
  });
