// Accès données pour les notes libres d'une demande DPAE — uniquement des requêtes,
// aucune règle métier ici (orchestrée par notesDemandeDpaeService.js), même découpage et même forme
// de résultat que core/dossier/notesDossierRepository.js (réutilisée telle quelle par le composant
// NotesDossier.jsx côté front : auteur_prenom, auteur_nom, auteur_role_libelle, date_creation).

// Scopée par entité (jointure vers demandes_dpae) en plus de la vérification faite par le service :
// une demande d'une autre entité ne renvoie jamais aucune note.
function listerNotesParDemande(bd, entiteId, demandeId) {
  return bd('notes_demande_dpae')
    .join('demandes_dpae', 'demandes_dpae.id', 'notes_demande_dpae.demande_dpae_id')
    .join('utilisateurs', 'utilisateurs.id', 'notes_demande_dpae.auteur_id')
    .join('roles', 'roles.id', 'utilisateurs.role_id')
    .where({ 'demandes_dpae.entite_id': entiteId, 'notes_demande_dpae.demande_dpae_id': demandeId })
    .select(
      'notes_demande_dpae.id',
      'notes_demande_dpae.contenu',
      'notes_demande_dpae.date_creation',
      'utilisateurs.prenom as auteur_prenom',
      'utilisateurs.nom as auteur_nom',
      'roles.libelle as auteur_role_libelle',
    )
    .orderBy([
      { column: 'notes_demande_dpae.date_creation', order: 'desc' },
      { column: 'notes_demande_dpae.id', order: 'desc' },
    ]);
}

async function ajouterNote(bd, { demandeId, auteurId, contenu }) {
  const [note] = await bd('notes_demande_dpae')
    .insert({ demande_dpae_id: demandeId, auteur_id: auteurId, contenu })
    .returning('id');
  return note.id;
}

module.exports = { listerNotesParDemande, ajouterNote };
