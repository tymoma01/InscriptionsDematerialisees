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

// Vue d'ensemble des rendez-vous de test, tous dossiers confondus (page Planification côté
// Coordination, CLAUDE.md : "planifie les tests") — 'test' explicitement plutôt qu'un paramètre
// type_rdv générique : même choix que evaluationRepository.listerRendezvousAEvaluer, cette page
// ne parle que de tests, pas de rendez-vous en général (ex. signature de contrat, à venir).
// formateur_id étant nullable, leftJoin (un rendez-vous pas encore assigné doit rester listé).
// dateDebut/dateFin : bornes du jour au format 'AAAA-MM-JJ' (dateFin exclusive), utilisées par le
// calendrier de disponibilité d'un formateur (voir CalendrierDisponibiliteFormateur.jsx) pour ne
// charger que le mois affiché. Comparées telles quelles à date_heure (timestamptz) : la précision
// est à la journée, suffisante pour un calendrier — pas de conversion de fuseau applicative ici,
// même niveau de simplicité que le reste du filtrage par date de ce dépôt (aVenirSeulement
// ci-dessous compare aussi directement à bd.fn.now()).
// Jointure gauche vers dossier_donnees_formulaire (bloc 'disponibilites', JSONB, migration 013)
// pour exposer le(s) poste(s) recherché(s) sur la colonne "Poste" de Planification.jsx — même
// patron que dossierRepository.listerDossiers / evaluationRepository.listerRendezvousAEvaluer.
// Keyed sur dossiers.id (pas rendezvous.id) : le bloc est propre au dossier, pas au rendez-vous.
function listerRendezvousTest(bd, entiteId, { aVenirSeulement, formateurId, dateDebut, dateFin } = {}) {
  const requete = bd('rendezvous')
    .join('dossiers', 'dossiers.id', 'rendezvous.dossier_id')
    .join('candidats', 'candidats.id', 'dossiers.candidat_id')
    .leftJoin('utilisateurs', 'utilisateurs.id', 'rendezvous.formateur_id')
    .leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
      this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
        'bloc_disponibilites.bloc_code',
        '=',
        bd.raw('?', ['disponibilites']),
      );
    })
    .where({ 'dossiers.entite_id': entiteId, 'rendezvous.type_rdv': 'test' })
    .select(
      'rendezvous.id',
      'rendezvous.dossier_id',
      'rendezvous.date_heure',
      'rendezvous.statut',
      'candidats.prenom as candidat_prenom',
      'candidats.nom as candidat_nom',
      'utilisateurs.prenom as formateur_prenom',
      'utilisateurs.nom as formateur_nom',
      'bloc_disponibilites.donnees as donnees_disponibilites',
    )
    .orderBy('rendezvous.date_heure', 'asc');

  if (aVenirSeulement) {
    requete.andWhere('rendezvous.date_heure', '>=', bd.fn.now()).whereIn('rendezvous.statut', ['prevu', 'confirme']);
  }
  if (formateurId) {
    requete.andWhere('rendezvous.formateur_id', formateurId);
  }
  if (dateDebut) {
    requete.andWhere('rendezvous.date_heure', '>=', dateDebut);
  }
  if (dateFin) {
    requete.andWhere('rendezvous.date_heure', '<', dateFin);
  }
  // Un calendrier de disponibilité ne doit montrer comme "occupé" que ce qui bloque
  // effectivement un nouveau créneau (même convention que compterRendezvousFormateurAuCreneau) —
  // un rendez-vous absent/annulé a libéré la place. Seulement quand une borne de date est fournie
  // : aVenirSeulement gère déjà ce filtre pour son propre usage (page Planification), pas la
  // peine de dupliquer le whereIn si les deux sont absents (comportement historique inchangé).
  if ((dateDebut || dateFin) && !aVenirSeulement) {
    requete.whereIn('rendezvous.statut', ['prevu', 'confirme']);
  }

  return requete;
}

// Rendez-vous de test actuellement "actif" d'un dossier (voir rendezvousService.
// verifierDelaiAvantReplanification) : le plus récent par date_heure parmi les rendez-vous 'test'
// encore 'prevu'/'confirme' — un rendez-vous 'absent'/'annule' a déjà été traité par le formateur
// (ou l'agent), il ne bloque plus rien. S'il existe plusieurs lignes 'prevu' pour ce dossier
// (aucune transition ne referme automatiquement l'ancien rendez-vous lors d'une replanification,
// voir ListeEvaluationsAFaire.jsx), c'est la plus récente qui représente le créneau réellement
// attendu par le formateur.
function trouverRendezvousTestActifDossier(bd, dossierId) {
  return bd('rendezvous')
    .where({ dossier_id: dossierId, type_rdv: 'test' })
    .whereIn('statut', ['prevu', 'confirme'])
    .orderBy('date_heure', 'desc')
    .first();
}

function mettreAJourStatutRendezvous(bd, rendezvousId, { statut, motifId }) {
  return bd('rendezvous')
    .where({ id: rendezvousId })
    .update({ statut, motif_id: motifId })
    .returning('*')
    .then(([rendezvous]) => rendezvous);
}

// Nombre de candidats déjà assignés à ce formateur au même horaire exact (voir
// rendezvousService.creerRendezvous, CAPACITE_MAX_FORMATEUR_PAR_CRENEAU) — 'prevu'/'confirme'
// uniquement : un rendez-vous marqué absent ou annulé libère la place, il ne doit pas compter
// dans l'occupation du créneau.
async function compterRendezvousFormateurAuCreneau(bd, formateurId, dateHeure) {
  const ligne = await bd('rendezvous')
    .where({ formateur_id: formateurId, date_heure: dateHeure })
    .whereIn('statut', ['prevu', 'confirme'])
    .count({ total: '*' })
    .first();
  return Number(ligne.total);
}

// Toujours créé au statut 'prevu' (voir rendezvousService.STATUTS_AUTORISES) — un rendez-vous ne
// naît jamais confirmé/absent/annulé, ces statuts ne se posent qu'après coup via
// mettreAJourStatutRendezvous. formateurId peut être nul (rendez-vous pas encore assigné) : voir
// rendezvousService.creerRendezvous pour la validation du rôle formateur en amont.
async function creerRendezvous(bd, { dossierId, typeRdv, dateHeure, formateurId, postesSelectionnes = [] }) {
  const [rendezvous] = await bd('rendezvous')
    .insert({
      dossier_id: dossierId,
      type_rdv: typeRdv,
      date_heure: dateHeure,
      formateur_id: formateurId,
      statut: 'prevu',
      // JSON.stringify explicite (même patron que dossierRepository.enregistrerDonneesBloc) :
      // ne pas laisser le driver pg deviner la sérialisation d'un tableau JS pour une colonne
      // jsonb (migration 039).
      postes_selectionnes: JSON.stringify(postesSelectionnes),
    })
    .returning('*');
  return rendezvous;
}

module.exports = {
  listerRendezvousARappeler,
  trouverRendezvousParId,
  listerRendezvousParDossier,
  listerRendezvousTest,
  mettreAJourStatutRendezvous,
  compterRendezvousFormateurAuCreneau,
  trouverRendezvousTestActifDossier,
  creerRendezvous,
};
