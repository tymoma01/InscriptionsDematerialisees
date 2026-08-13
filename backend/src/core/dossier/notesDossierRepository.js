// Accès données pour les notes libres d'un dossier — uniquement des requêtes, aucune règle
// métier ici (orchestrée par notesDossierService.js), même découpage que relanceRepository.js.

// Jointure sur utilisateurs pour exposer qui a écrit la note (pas seulement auteur_id) — même
// principe que relanceRepository.listerRelancesParDossier. dossierId est déjà vérifié comme
// appartenant à l'entité par notesDossierService avant d'appeler cette fonction.
function listerNotesParDossier(bd, dossierId) {
  return bd('notes_dossier')
    .join('utilisateurs', 'utilisateurs.id', 'notes_dossier.auteur_id')
    .where({ 'notes_dossier.dossier_id': dossierId })
    .select(
      'notes_dossier.id',
      'notes_dossier.contenu',
      'notes_dossier.date_creation',
      'utilisateurs.prenom as auteur_prenom',
      'utilisateurs.nom as auteur_nom',
    )
    .orderBy('notes_dossier.date_creation', 'desc');
}

// Notes de plusieurs dossiers en une seule requête (voir rendezvousService.
// listerHistoriqueRendezvousDossiers, panneau "Historique des rendez-vous sélectionnés" — bloc
// "Notes du dossier" affiché une fois par candidat, PAS par rendez-vous : notes_dossier n'a aucune
// colonne rendezvous_id, ces notes ne sont donc jamais rattachables à un rendez-vous précis, voir
// décision utilisateur du 2026-08-13). Scopée par entiteId (jointure vers dossiers) plutôt qu'un
// verifierDossierAppartientEntite par dossier — même patron IDOR que
// rendezvousRepository.listerHistoriqueRendezvousParDossiers : un dossierId d'une autre entité ne
// matche simplement aucune ligne, pas d'erreur levée ici.
function listerNotesParDossiers(bd, entiteId, dossierIds) {
  return bd('notes_dossier')
    .join('dossiers', 'dossiers.id', 'notes_dossier.dossier_id')
    .join('utilisateurs', 'utilisateurs.id', 'notes_dossier.auteur_id')
    .where('dossiers.entite_id', entiteId)
    .whereIn('notes_dossier.dossier_id', dossierIds)
    .select(
      'notes_dossier.id',
      'notes_dossier.dossier_id',
      'notes_dossier.contenu',
      'notes_dossier.date_creation',
      'utilisateurs.prenom as auteur_prenom',
      'utilisateurs.nom as auteur_nom',
    )
    .orderBy('notes_dossier.date_creation', 'desc');
}

async function ajouterNote(bd, { dossierId, auteurId, contenu }) {
  const [note] = await bd('notes_dossier')
    .insert({ dossier_id: dossierId, auteur_id: auteurId, contenu })
    .returning('id');
  return note.id;
}

module.exports = {
  listerNotesParDossier,
  listerNotesParDossiers,
  ajouterNote,
};
