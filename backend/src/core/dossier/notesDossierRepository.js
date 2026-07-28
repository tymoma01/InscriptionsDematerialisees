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

async function ajouterNote(bd, { dossierId, auteurId, contenu }) {
  const [note] = await bd('notes_dossier')
    .insert({ dossier_id: dossierId, auteur_id: auteurId, contenu })
    .returning('id');
  return note.id;
}

module.exports = {
  listerNotesParDossier,
  ajouterNote,
};
