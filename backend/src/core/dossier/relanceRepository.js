// Accès données pour les relances — uniquement des requêtes, aucune règle métier ici (orchestrée
// par relanceService.js), même découpage que dossierRepository.js / pieceJustificativeRepository.js.

// Jointure sur utilisateurs pour exposer qui a fait la relance (pas seulement utilisateur_id) —
// évite au consommateur (historique affiché à l'accueil) une seconde requête par ligne. dossierId
// est déjà vérifié comme appartenant à l'entité par relanceService (via
// dossierRepository.trouverDossierParId) avant d'appeler cette fonction — même principe que
// pieceJustificativeRepository.listerPiecesParDossier.
function listerRelancesParDossier(trx, dossierId) {
  return trx('relances')
    .join('utilisateurs', 'utilisateurs.id', 'relances.utilisateur_id')
    .where({ 'relances.dossier_id': dossierId })
    .select(
      'relances.id',
      'relances.canal',
      'relances.resultat',
      'relances.date_envoi',
      'relances.rendezvous_id',
      'utilisateurs.prenom as agent_prenom',
      'utilisateurs.nom as agent_nom',
    )
    .orderBy('relances.date_envoi', 'desc');
}

// rendezvousId (migration 029) reste optionnel : une relance manuelle (accueil/coordination,
// via relanceService.enregistrerRelance) n'est rattachée à aucun rendez-vous précis ; seul le
// rappel automatique de créneau (voir core/rendezvous/rappelService.js) le renseigne, pour
// pouvoir détecter qu'un rappel a déjà été envoyé pour CE rendez-vous précis.
async function enregistrerRelance(trx, { dossierId, canal, resultat, utilisateurId, rendezvousId = null }) {
  const [relance] = await trx('relances')
    .insert({ dossier_id: dossierId, canal, resultat, utilisateur_id: utilisateurId, rendezvous_id: rendezvousId })
    .returning('id');
  return relance.id;
}

module.exports = {
  listerRelancesParDossier,
  enregistrerRelance,
};
