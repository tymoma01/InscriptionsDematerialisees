// Présence constatée par le formateur/inspecteur LE JOUR MÊME (bouton "Présent(e)",
// ListeEvaluationsAFaire.jsx, audit 2026-09-09) — distincte de rendezvous.statut = 'confirme'
// (présence confirmée À L'AVANCE par le candidat, voir rendezvousService.js, commentaire de
// STATUTS_AUTORISES : "jamais un constat a posteriori"). Ne remplace ni ne modifie `statut` :
// le badge "Prévu" affiché sur cette page ne doit pas changer suite à ce clic (décision
// utilisateur) — seul effet voulu, exclure ce rendez-vous de la bascule automatique "Test non
// réalisé" (voir rendezvousRepository.listerRendezvousTestNonRealisesAutomatiquement), même une
// fois le délai de grâce de 24h dépassé.
// Nullable : NULL tant qu'aucun formateur/inspecteur n'a cliqué "Présent(e)" pour ce rendez-vous —
// c'est justement ce NULL que la bascule automatique utilise pour rester éligible.
exports.up = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.timestamp('date_presence_confirmee', { useTz: true }).nullable();
  });

exports.down = (knex) =>
  knex.schema.alterTable('rendezvous', (table) => {
    table.dropColumn('date_presence_confirmee');
  });
