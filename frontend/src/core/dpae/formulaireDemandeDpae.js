// Données du formulaire de demande DPAE (DemandeDpae.jsx) : valeurs initiales d'une nouvelle demande
// et conversion d'une demande existante (forme renvoyée par GET /api/dpae/:id) vers la forme du
// formulaire, pour la préremplir en mode modification. Module pur (aucune dépendance React), testé
// par formulaireDemandeDpae.test.js.

export const JOURS_SEMAINE = [
  { code: 'lundi', libelle: 'Lundi' },
  { code: 'mardi', libelle: 'Mardi' },
  { code: 'mercredi', libelle: 'Mercredi' },
  { code: 'jeudi', libelle: 'Jeudi' },
  { code: 'vendredi', libelle: 'Vendredi' },
  { code: 'samedi', libelle: 'Samedi' },
  { code: 'dimanche', libelle: 'Dimanche' },
];

export function semaineTypeInitiale() {
  return JOURS_SEMAINE.map(({ code }) => ({ jour: code, statut: 'repos', heureDebut: '', heureFin: '' }));
}

export function donneesInitiales() {
  return {
    typeDemande: '',
    salarieNom: '',
    salariePrenom: '',
    salarieTelephone: '',
    salarieDejaEmploye: false,
    candidatId: null,
    // Site(s) d'affectation : ids du référentiel `sites_affectation`, remplace l'ancien
    // champ texte `hotel` (plus envoyé, voir SelecteurSitesAffectation.jsx).
    sitesAffectationIds: [],
    typeContrat: '',
    motifCdd: '',
    salarieRemplaceNom: '',
    dateFinAbsence: '',
    raisonSurcroit: '',
    division: '',
    divisionAutre: '',
    poste: '',
    posteAutre: '',
    dateDebut: '',
    dateFin: '',
    heureArriveeJ1: '',
    heuresParMois: '',
    modificationsDemandees: false,
    modificationHoraires: false,
    modificationJoursRepos: false,
    modificationAffectation: false,
    nouvelleAffectation: '',
    typeChangementJours: '',
    joursConcernes: [],
    raisonChangementJours: '',
    raisonIdentiqueContrat: '',
    semaineType: semaineTypeInitiale(),
    horairesDifferentsParJour: false,
    heureDebutCommune: '',
    heureFinCommune: '',
    autreChoseSignaler: '',
    verifBesoinHotel: false,
    verifTousJoursInclus: false,
    verifNonPlanification: false,
  };
}

const deuxChiffres = (nombre) => String(nombre).padStart(2, '0');

// Colonne `date` renvoyée par l'API (minuit heure locale du serveur, sérialisé en UTC) -> « AAAA-MM-JJ »
// pour un <input type="date">, relue dans le fuseau du poste — même conversion que l'affichage des
// dates (formaterJour, affichageDpae.js), jamais un découpage de la chaîne.
function jourPourChamp(valeur) {
  if (!valeur) return '';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

// 'HH:MM:SS' (colonne `time`) -> 'HH:MM' pour un <input type="time">.
const heurePourChamp = (valeur) => (valeur ? String(valeur).slice(0, 5) : '');

// Nombre décimal renvoyé en chaîne (« 151.67 », « 40.00 ») -> chaîne du champ numérique.
const nombrePourChamp = (valeur) => (valeur === null || valeur === undefined || valeur === '' ? '' : String(Number(valeur)));

// Demande existante -> données du formulaire. La semaine type est toujours ramenée à 7 jours dans
// l'ordre de JOURS_SEMAINE ; quand les horaires ne diffèrent pas selon les jours, les heures
// communes sont reprises du premier jour travaillé (le formulaire les recopie sur chaque jour à
// l'enregistrement).
export function donneesFormulaireDepuisDemande(demande) {
  const semaineEnBase = Array.isArray(demande.semaine_type) ? demande.semaine_type : [];
  const semaineType = JOURS_SEMAINE.map(({ code }) => {
    const jour = semaineEnBase.find((entree) => entree.jour === code);
    return {
      jour: code,
      statut: jour?.statut === 'travail' ? 'travail' : 'repos',
      heureDebut: jour?.heureDebut ?? '',
      heureFin: jour?.heureFin ?? '',
    };
  });
  const horairesDifferentsParJour = Boolean(demande.horaires_differents_par_jour);
  const premierJourTravaille = semaineType.find((jour) => jour.statut === 'travail');

  return {
    typeDemande: demande.type_demande ?? '',
    salarieNom: demande.salarie_nom ?? '',
    salariePrenom: demande.salarie_prenom ?? '',
    salarieTelephone: demande.salarie_telephone ?? '',
    salarieDejaEmploye: Boolean(demande.salarie_deja_employe),
    candidatId: demande.candidat_id ?? null,
    sitesAffectationIds: (demande.sites_affectation ?? []).map((site) => site.id),
    typeContrat: demande.type_contrat ?? '',
    motifCdd: demande.motif_cdd ?? '',
    salarieRemplaceNom: demande.salarie_remplace_nom ?? '',
    dateFinAbsence: jourPourChamp(demande.date_fin_absence),
    raisonSurcroit: demande.raison_surcroit ?? '',
    division: demande.division ?? '',
    divisionAutre: demande.division_autre ?? '',
    poste: demande.poste ?? '',
    posteAutre: demande.poste_autre ?? '',
    dateDebut: jourPourChamp(demande.date_debut),
    dateFin: jourPourChamp(demande.date_fin),
    heureArriveeJ1: heurePourChamp(demande.heure_arrivee_j1),
    heuresParMois: nombrePourChamp(demande.heures_par_mois),
    modificationsDemandees: Boolean(demande.modifications_demandees),
    modificationHoraires: Boolean(demande.modification_horaires),
    modificationJoursRepos: Boolean(demande.modification_jours_repos),
    modificationAffectation: Boolean(demande.modification_affectation),
    nouvelleAffectation: demande.nouvelle_affectation ?? '',
    typeChangementJours: demande.type_changement_jours ?? '',
    // Dates des jours concernés : déjà des « AAAA-MM-JJ » dans le JSON, reprises telles quelles.
    joursConcernes: (demande.jours_concernes ?? []).map((jour) => ({ ...jour, date: jour.date ?? '' })),
    raisonChangementJours: demande.raison_changement_jours ?? '',
    raisonIdentiqueContrat: demande.raison_identique_contrat ?? '',
    semaineType,
    horairesDifferentsParJour,
    heureDebutCommune: horairesDifferentsParJour ? '' : (premierJourTravaille?.heureDebut ?? ''),
    heureFinCommune: horairesDifferentsParJour ? '' : (premierJourTravaille?.heureFin ?? ''),
    autreChoseSignaler: demande.autre_chose_signaler ?? '',
    verifBesoinHotel: Boolean(demande.verif_besoin_hotel),
    verifTousJoursInclus: Boolean(demande.verif_tous_jours_inclus),
    verifNonPlanification: Boolean(demande.verif_non_planification),
  };
}
