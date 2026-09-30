// Accès données pour les demandes DPAE — uniquement des requêtes, aucune règle métier ici
// (orchestrée par demandeDpaeService.js), même découpage que relanceRepository.js.

const COLONNES_DEMANDE = [
  'demandes_dpae.id',
  'demandes_dpae.statut',
  'demandes_dpae.type_demande',
  'demandes_dpae.salarie_nom',
  'demandes_dpae.salarie_prenom',
  'demandes_dpae.salarie_telephone',
  'demandes_dpae.salarie_deja_employe',
  'demandes_dpae.candidat_id',
  'demandes_dpae.hotel',
  'demandes_dpae.type_contrat',
  'demandes_dpae.motif_cdd',
  'demandes_dpae.salarie_remplace_nom',
  'demandes_dpae.date_fin_absence',
  'demandes_dpae.raison_surcroit',
  'demandes_dpae.division',
  'demandes_dpae.division_autre',
  'demandes_dpae.poste',
  'demandes_dpae.poste_autre',
  'demandes_dpae.date_debut',
  'demandes_dpae.date_fin',
  'demandes_dpae.heure_arrivee_j1',
  'demandes_dpae.heures_par_mois',
  'demandes_dpae.modifications_demandees',
  'demandes_dpae.modification_horaires',
  'demandes_dpae.modification_jours_repos',
  'demandes_dpae.modification_affectation',
  'demandes_dpae.nouvelle_affectation',
  'demandes_dpae.type_changement_jours',
  'demandes_dpae.jours_concernes',
  'demandes_dpae.raison_changement_jours',
  'demandes_dpae.raison_identique_contrat',
  'demandes_dpae.semaine_type',
  'demandes_dpae.horaires_differents_par_jour',
  'demandes_dpae.autre_chose_signaler',
  'demandes_dpae.verif_besoin_hotel',
  'demandes_dpae.verif_tous_jours_inclus',
  'demandes_dpae.verif_non_planification',
  'demandes_dpae.motif_rejet',
  // Dernière mise en attente (migration 070) — motif affiché sur la fiche tant que la demande est
  // 'en_attente'.
  'demandes_dpae.motif_mise_en_attente',
  'demandes_dpae.date_mise_en_attente',
  'demandes_dpae.date_creation',
  'demandes_dpae.date_maj',
  'demandes_dpae.date_traitement',
  'demandeur.id as demandeur_id',
  'demandeur.nom as demandeur_nom',
  'demandeur.prenom as demandeur_prenom',
  'traitant.id as traite_par_utilisateur_id',
  'traitant.nom as traitant_nom',
  'traitant.prenom as traitant_prenom',
  'dossiers.id as dossier_id',
];

// Jointures sur utilisateurs (demandeur + traitant, alias distincts) et dossiers — évite au
// consommateur (SuiviDemandesDpae.jsx, TraitementDpae.jsx, DetailDemandeDpae.jsx) une requête
// supplémentaire par ligne, même principe que relanceRepository.listerRelancesParDossier. Pas de
// jointure `lieux` (retirée en même temps que `lieu_id`, voir migration 066 et son commentaire) :
// `hotel` est un simple texte libre porté directement par `demandes_dpae`.
//
// dossiers.candidat_id = demandes_dpae.candidat_id (module Demandes DPAE, 2026-09-28, demande
// utilisateur : "en un clic accéder à la fiche du candidat" depuis une demande) — leftJoin sans
// risque de doublonner la ligne : un candidat n'a jamais plus d'un dossier (unicité NIR/email par
// entité sur `candidats`, migration 032 ; dossierService.inscrireCandidat crée toujours candidat +
// dossier ensemble dans la même transaction, jamais un second dossier pour un candidat existant —
// voir scripts/testUniciteInscriptionCandidat.js). `dossiers.entite_id` ajouté à la condition de
// jointure par défense en profondeur (cohérent avec le reste du projet), bien que déjà garanti en
// pratique par le scope entité de `candidat_id` lui-même. `dossier_id` reste NULL si le salarié
// n'est pas (ou plus) un candidat connu du système (saisie libre, voir RechercheCandidatSalarie.jsx) —
// c'est ce NULL qui permet au front de masquer le lien "Voir la fiche candidat" le cas échéant.
function requeteDemandesAvecJointures(trx) {
  return trx('demandes_dpae')
    .join('utilisateurs as demandeur', 'demandeur.id', 'demandes_dpae.demandeur_id')
    .leftJoin('utilisateurs as traitant', 'traitant.id', 'demandes_dpae.traite_par_utilisateur_id')
    .leftJoin('dossiers', function jointureDossier() {
      this.on('dossiers.candidat_id', '=', 'demandes_dpae.candidat_id').andOn(
        'dossiers.entite_id',
        '=',
        'demandes_dpae.entite_id',
      );
    })
    .select(COLONNES_DEMANDE);
}

function trouverDemandeParId(trx, entiteId, id) {
  return requeteDemandesAvecJointures(trx).where({ 'demandes_dpae.entite_id': entiteId, 'demandes_dpae.id': id }).first();
}

function listerDemandesParDemandeur(trx, entiteId, demandeurId) {
  return requeteDemandesAvecJointures(trx)
    .where({ 'demandes_dpae.entite_id': entiteId, 'demandes_dpae.demandeur_id': demandeurId })
    .orderBy([
      { column: 'demandes_dpae.date_creation', order: 'desc' },
      // Départage stable de deux demandes créées au même instant (2026-09-30).
      { column: 'demandes_dpae.id', order: 'desc' },
    ]);
}

// statut optionnel : la file RH filtre par défaut sur 'envoyee' (voir demandeDpaeService), mais
// peut aussi lister l'historique complet (traitées incluses) sans ce filtre.
function listerDemandesPourRh(trx, entiteId, statut) {
  const requete = requeteDemandesAvecJointures(trx).where({ 'demandes_dpae.entite_id': entiteId });
  if (statut) requete.andWhere({ 'demandes_dpae.statut': statut });
  return requete.orderBy([
    { column: 'demandes_dpae.date_creation', order: 'desc' },
    // Départage stable de deux demandes créées au même instant (2026-09-30).
    { column: 'demandes_dpae.id', order: 'desc' },
  ]);
}

async function creerDemande(trx, donnees) {
  const [demande] = await trx('demandes_dpae')
    .insert({
      entite_id: donnees.entiteId,
      demandeur_id: donnees.demandeurId,
      statut: 'envoyee',
      type_demande: donnees.typeDemande,
      salarie_nom: donnees.salarieNom,
      salarie_prenom: donnees.salariePrenom,
      salarie_telephone: donnees.salarieTelephone || null,
      salarie_deja_employe: donnees.salarieDejaEmploye,
      candidat_id: donnees.candidatId || null,
      hotel: donnees.hotel || null,
      type_contrat: donnees.typeContrat || null,
      motif_cdd: donnees.motifCdd || null,
      salarie_remplace_nom: donnees.salarieRemplaceNom || null,
      date_fin_absence: donnees.dateFinAbsence || null,
      raison_surcroit: donnees.raisonSurcroit || null,
      division: donnees.division || null,
      division_autre: donnees.divisionAutre || null,
      poste: donnees.poste || null,
      poste_autre: donnees.posteAutre || null,
      date_debut: donnees.dateDebut || null,
      date_fin: donnees.dateFin || null,
      heure_arrivee_j1: donnees.heureArriveeJ1 || null,
      heures_par_mois: donnees.heuresParMois ?? null,
      modifications_demandees: Boolean(donnees.modificationsDemandees),
      modification_horaires: Boolean(donnees.modificationHoraires),
      modification_jours_repos: Boolean(donnees.modificationJoursRepos),
      modification_affectation: Boolean(donnees.modificationAffectation),
      nouvelle_affectation: donnees.nouvelleAffectation || null,
      type_changement_jours: donnees.typeChangementJours || null,
      jours_concernes: JSON.stringify(donnees.joursConcernes ?? []),
      raison_changement_jours: donnees.raisonChangementJours || null,
      raison_identique_contrat: donnees.raisonIdentiqueContrat || null,
      semaine_type: JSON.stringify(donnees.semaineType ?? []),
      horaires_differents_par_jour: Boolean(donnees.horairesDifferentsParJour),
      autre_chose_signaler: donnees.autreChoseSignaler || null,
      verif_besoin_hotel: Boolean(donnees.verifBesoinHotel),
      verif_tous_jours_inclus: Boolean(donnees.verifTousJoursInclus),
      verif_non_planification: Boolean(donnees.verifNonPlanification),
      // Pas de colonne date_envoi distincte : une demande créée est immédiatement 'envoyee' (pas
      // de statut brouillon, voir migration 066), date_creation fait donc foi comme date d'envoi.
    })
    .returning('id');
  return demande.id;
}

function marquerTraitee(trx, id, { statut, traitantId, motifRejet = null }) {
  return trx('demandes_dpae').where({ id }).update({
    statut,
    traite_par_utilisateur_id: traitantId,
    motif_rejet: motifRejet,
    date_traitement: trx.fn.now(),
    date_maj: trx.fn.now(),
  });
}

// Mise en attente (2026-09-30) : n'est PAS une décision — date_traitement et
// traite_par_utilisateur_id restent vides (réservés à la validation/au rejet, voir migration 070).
function marquerEnAttente(trx, id, { traitantId, motif }) {
  return trx('demandes_dpae').where({ id }).update({
    statut: 'en_attente',
    motif_mise_en_attente: motif,
    date_mise_en_attente: trx.fn.now(),
    mis_en_attente_par_id: traitantId,
    date_maj: trx.fn.now(),
  });
}

module.exports = {
  trouverDemandeParId,
  listerDemandesParDemandeur,
  listerDemandesPourRh,
  creerDemande,
  marquerTraitee,
  marquerEnAttente,
};
