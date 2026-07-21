// Accès données pour les rendez-vous — uniquement des requêtes, aucune règle métier ici
// (orchestrée par rappelService.js / rendezvousService.js), même découpage que dossierRepository.js.

// Rendez-vous à venir dans la fenêtre [maintenant, maintenant + fenetreHeures], pas encore
// confirmés/annulés ('prevu' uniquement, voir rendezvous.statut : 'prevu'|'confirme'|'absent'|
// 'annule'), et n'ayant pas déjà reçu de rappel — le NOT EXISTS sur `relances.rendezvous_id`
// (migration 029) est ce qui empêche un double envoi d'un run à l'autre du job de rappel (CLAUDE.md,
// besoin Accueil/Coordination "ne pas relancer en double", ici appliqué au rappel automatique).
function listerRendezvousARappeler(bd, entiteId, { fenetreHeures }) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('rendezvous.statut', 'prevu')
    .andWhereRaw("rendezvous.date_heure BETWEEN now() AND now() + make_interval(hours => ?)", [fenetreHeures])
    .whereNotExists(function () {
      this.select(1).from('relances').whereRaw('relances.rendezvous_id = rendezvous.id');
    })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.type_rdv',
      'rendezvous.date_heure',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
    );
}

// Coordonnées saisies au bloc 'coordonnees' du formulaire d'inscription (JSONB, voir
// dossier_donnees_formulaire, migration 013) — pas de colonne dédiée telephone/email sur
// `candidats` (voir Modularité, CLAUDE.md : les champs d'un bloc restent dans le JSONB générique).
async function trouverCoordonneesCandidat(bd, dossierId) {
  const ligne = await bd('dossier_donnees_formulaire')
    .where({ dossier_id: dossierId, bloc_code: 'coordonnees' })
    .first();
  return ligne?.donnees ?? null;
}

// Scopé par entiteId (jointure vers dossiers) : un rendezvousId est un entier séquentiel, donc
// devinable — sans ce filtre, un agent authentifié d'une entité pourrait agir sur le rendez-vous
// d'une autre entité en devinant son id, même faille IDOR déjà corrigée pour les pièces
// justificatives et les relances (voir pieceJustificativeService.js / relanceService.js).
function trouverRendezvousParId(bd, entiteId, rendezvousId) {
  return bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .where({ 'rendezvous.id': rendezvousId, 'dossiers.entite_id': entiteId })
    .select('rendezvous.*')
    .first();
}

// Jointure sur motifs pour exposer le libellé du motif de désistement (pas seulement motif_id) —
// évite au consommateur (écran coordination) une seconde requête par ligne. dossierId est déjà
// vérifié comme appartenant à l'entité par rendezvousService avant d'appeler cette fonction,
// même principe que pieceJustificativeRepository.listerPiecesParDossier.
function listerRendezvousParDossier(bd, dossierId) {
  return bd('rendezvous')
    .leftJoin('motifs', 'motifs.id', 'rendezvous.motif_id')
    .where({ 'rendezvous.dossier_id': dossierId })
    .select(
      'rendezvous.id',
      'rendezvous.type_rdv',
      'rendezvous.date_heure',
      'rendezvous.statut',
      'motifs.code as motif_code',
      'motifs.libelle as motif_libelle',
    )
    .orderBy('rendezvous.date_heure', 'desc');
}

function mettreAJourStatutRendezvous(bd, rendezvousId, { statut, motifId }) {
  return bd('rendezvous')
    .where({ id: rendezvousId })
    .update({ statut, motif_id: motifId })
    .returning('*')
    .then(([rendezvous]) => rendezvous);
}

module.exports = {
  listerRendezvousARappeler,
  trouverCoordonneesCandidat,
  trouverRendezvousParId,
  listerRendezvousParDossier,
  mettreAJourStatutRendezvous,
};
