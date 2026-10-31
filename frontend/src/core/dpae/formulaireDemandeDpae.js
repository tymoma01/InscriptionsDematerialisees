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

// Sites d'affectation de chaque jour de la semaine type (`siteIds`, LISTE d'identifiants ajoutée au
// JSON existant ; l'ancienne forme à un seul `siteId` est lue comme une liste d'un élément) :
//  - jour de repos : aucun site ;
//  - un seul site sélectionné : il est attribué à tous les jours travaillés (aucune liste à remplir) ;
//  - plusieurs sites : seuls les sites du jour qui font toujours partie de la sélection sont conservés
//    (un site retiré de la demande est retiré des jours qui l'utilisaient) ; un jour sans aucun site
//    n'a plus de clé `siteIds` (il redevient « à choisir »).
// Ne modifie pas la semaine reçue.
export function affecterSitesSemaine(semaineType, sitesIds) {
  return semaineType.map(({ siteId, siteIds, ...jour }) => {
    if (jour.statut !== 'travail') return jour;
    const sites = sitesIds.length === 1 ? sitesIds : (siteIds ?? (siteId ? [siteId] : [])).filter((id) => sitesIds.includes(id));
    return sites.length === 0 ? jour : { ...jour, siteIds: sites };
  });
}

// Jours travaillés qui se retrouvent SANS site parce que leurs sites ont été retirés de la sélection (et
// qu'il reste plusieurs sites à choisir) : à signaler en erreur.
export function joursPrivesDeSite(ancienneSemaine, nouvelleSemaine, sitesIds) {
  if (sitesIds.length < 2) return [];
  return nouvelleSemaine
    .filter((jour, index) => jour.statut === 'travail' && !jour.siteIds?.length && ancienneSemaine[index]?.siteIds?.length > 0)
    .map((jour) => jour.jour);
}

// Pause : minutes entières, de 0 à 4 h par pas de 15 min (listes déroulantes du formulaire).
export const HEURES_PAUSE = [0, 1, 2, 3, 4];
export const MINUTES_PAUSE = [0, 15, 30, 45];

export const TYPES_CONTRAT = ['cdd', 'cdi', 'avenant'];

// Entité (division) d'un candidat choisi dans la recherche : celle de son type de poste recherché à
// l'inscription, qui désigne aussi sa base Pégase (pegase_config.base_par_type_poste côté serveur).
// Type inconnu : l'Entité déjà saisie est gardée.
const DIVISION_PAR_TYPE_POSTE = { bureau: 'tertiaire', hotel: 'hotellerie' };

export function divisionDuCandidat(candidat, divisionActuelle) {
  return DIVISION_PAR_TYPE_POSTE[candidat?.type_poste] ?? divisionActuelle;
}

export function semaineTypeInitiale() {
  return JOURS_SEMAINE.map(({ code }) => ({ jour: code, statut: 'repos', heureDebut: '', heureFin: '', pauseMinutes: 0 }));
}

const enMinutes = (heure) => Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));

// Durée d'une journée en minutes (une fin avant le début désigne une journée qui passe minuit) ;
// null tant que les deux heures ne sont pas saisies.
function dureeJournee(heureDebut, heureFin) {
  if (!heureDebut || !heureFin) return null;
  const debut = enMinutes(heureDebut);
  const fin = enMinutes(heureFin);
  return fin > debut ? fin - debut : fin - debut + 24 * 60;
}

// Pause en minutes lue en base : absente (demande antérieure aux pauses) ou invalide = 0.
const pauseDepuisBase = (valeur) => (Number.isInteger(valeur) && valeur > 0 ? valeur : 0);

const FORMAT_HEURES_PAR_MOIS = /^\d+([.,]\d{1,2})?$/;
export const MESSAGE_HEURES_PAR_MOIS = 'Les heures/mois doivent être un nombre positif, avec 2 décimales au plus.';

// Saisie des heures/mois (virgule ou point) -> nombre ; chaîne vide -> null (champ facultatif) ;
// saisie invalide (lettres, plus de 2 décimales, négative, nulle, au-delà de 999,99) -> NaN.
export function analyserHeuresParMois(saisie) {
  const texte = String(saisie ?? '').trim();
  if (texte === '') return null;
  if (!FORMAT_HEURES_PAR_MOIS.test(texte)) return Number.NaN;
  const nombre = Number(texte.replace(',', '.'));
  return nombre > 0 && nombre <= 999.99 ? nombre : Number.NaN;
}

export function donneesInitiales() {
  return {
    typeDemande: '',
    salarieNom: '',
    salariePrenom: '',
    salarieTelephone: '',
    // Obligatoire : ni Oui ni Non n'est présélectionné.
    salarieDejaEmploye: null,
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
    echelon: '',
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
    pauseCommuneMinutes: 0,
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

// Nombre décimal renvoyé en chaîne (« 151.67 », « 40.00 ») -> chaîne du champ de saisie, avec la
// virgule française (« 151,67 », « 40 »).
const nombrePourChamp = (valeur) => (valeur === null || valeur === undefined || valeur === '' ? '' : String(Number(valeur)).replace('.', ','));

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
      pauseMinutes: pauseDepuisBase(jour?.pauseMinutes),
      // Ancienne forme (un seul siteId) convertie en liste ; demande antérieure au site par jour :
      // aucun site (rien n'est inventé).
      ...(jour?.siteIds?.length ? { siteIds: jour.siteIds } : jour?.siteId ? { siteIds: [jour.siteId] } : {}),
    };
  });
  const sitesAffectationIds = (demande.sites_affectation ?? []).map((site) => site.id);
  const horairesDifferentsParJour = Boolean(demande.horaires_differents_par_jour);
  const semaineAffectee = affecterSitesSemaine(semaineType, sitesAffectationIds);
  const premierJourTravaille = semaineType.find((jour) => jour.statut === 'travail');

  return {
    typeDemande: demande.type_demande ?? '',
    salarieNom: demande.salarie_nom ?? '',
    salariePrenom: demande.salarie_prenom ?? '',
    salarieTelephone: demande.salarie_telephone ?? '',
    salarieDejaEmploye: Boolean(demande.salarie_deja_employe),
    candidatId: demande.candidat_id ?? null,
    sitesAffectationIds,
    typeContrat: demande.type_contrat ?? '',
    motifCdd: demande.motif_cdd ?? '',
    salarieRemplaceNom: demande.salarie_remplace_nom ?? '',
    dateFinAbsence: jourPourChamp(demande.date_fin_absence),
    raisonSurcroit: demande.raison_surcroit ?? '',
    division: demande.division ?? '',
    divisionAutre: demande.division_autre ?? '',
    poste: demande.poste ?? '',
    posteAutre: demande.poste_autre ?? '',
    echelon: demande.echelon ?? '',
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
    semaineType: semaineAffectee,
    horairesDifferentsParJour,
    heureDebutCommune: horairesDifferentsParJour ? '' : (premierJourTravaille?.heureDebut ?? ''),
    heureFinCommune: horairesDifferentsParJour ? '' : (premierJourTravaille?.heureFin ?? ''),
    pauseCommuneMinutes: horairesDifferentsParJour ? 0 : (premierJourTravaille?.pauseMinutes ?? 0),
    autreChoseSignaler: demande.autre_chose_signaler ?? '',
    verifBesoinHotel: Boolean(demande.verif_besoin_hotel),
    verifTousJoursInclus: Boolean(demande.verif_tous_jours_inclus),
    verifNonPlanification: Boolean(demande.verif_non_planification),
  };
}

// Échelons proposés pour un poste, d'après la configuration de l'entité (GET /api/dpae/configuration).
export function echelonsDuPoste(echelonsParPoste, poste) {
  return echelonsParPoste?.[poste] ?? [];
}

// Changer de poste réinitialise l'échelon ; un poste n'ayant qu'un échelon le présélectionne.
export function donneesApresChangementPoste(donnees, poste, echelonsParPoste) {
  const echelons = echelonsDuPoste(echelonsParPoste, poste);
  return { ...donnees, poste, echelon: echelons.length === 1 ? echelons[0] : '' };
}

// Contrôles du formulaire avant envoi, MÊMES règles et mêmes messages que le serveur (schéma
// demandeBaseSchema et verifierReglesDemande, backend/src/api/routes/dpae.routes.js), qui reste seul
// juge. Renvoie les erreurs DANS L'ORDRE DU FORMULAIRE : [{ champ, message }] ; la première reçoit le
// défilement. Clés de champ : 'salarieDejaEmploye', 'sites', 'typeContrat', 'motifCdd', 'poste', 'echelon',
// 'dateDebut', 'dateFin', et 'semaine:<jour>' pour le site d'un jour travaillé. Les champs du CDD ne sont
// contrôlés que pour un CDD.
export function validerFormulaire(donnees, echelonsParPoste = {}) {
  const erreurs = [];
  const refuser = (champ, message) => erreurs.push({ champ, message });

  if (typeof donnees.salarieDejaEmploye !== 'boolean') refuser('salarieDejaEmploye', 'Indiquez si le salarié a déjà travaillé chez nous.');
  if (donnees.sitesAffectationIds.length === 0) refuser('sites', "Sélectionnez au moins un site d'affectation avant d'envoyer la demande.");
  if (!TYPES_CONTRAT.includes(donnees.typeContrat)) refuser('typeContrat', 'Le type de contrat est obligatoire.');
  const estCdd = donnees.typeContrat === 'cdd';
  if (estCdd && !donnees.motifCdd) refuser('motifCdd', 'La raison du CDD est obligatoire.');
  if (!donnees.poste) refuser('poste', 'Le poste est obligatoire.');
  const echelons = echelonsDuPoste(echelonsParPoste, donnees.poste);
  if (echelons.length > 0 && !echelons.includes(donnees.echelon)) refuser('echelon', "L'échelon est obligatoire pour ce poste.");
  if (!donnees.dateDebut.trim()) refuser('dateDebut', 'Le premier jour est obligatoire.');
  if (estCdd && !donnees.dateFin) refuser('dateFin', 'Le dernier jour est obligatoire pour un CDD.');
  // Avenant : dernier jour facultatif, mais s'il est renseigné il ne peut pas précéder le premier.
  if ((estCdd || donnees.typeContrat === 'avenant') && donnees.dateFin && donnees.dateDebut && donnees.dateFin < donnees.dateDebut) {
    refuser('dateFin', 'Le dernier jour ne peut pas précéder le premier jour.');
  }
  if (Number.isNaN(analyserHeuresParMois(donnees.heuresParMois))) refuser('heuresParMois', MESSAGE_HEURES_PAR_MOIS);
  if (donnees.sitesAffectationIds.length > 1) {
    for (const jour of donnees.semaineType) {
      if (jour.statut === 'travail' && !(jour.siteIds ?? []).some((id) => donnees.sitesAffectationIds.includes(id))) {
        refuser(`semaine:${jour.jour}`, 'Au moins un site est obligatoire pour ce jour.');
      }
    }
  }
  // Pause plus courte que la journée : une seule pause commune, ou une par jour travaillé.
  const messagePause = 'La pause doit être inférieure à la durée de la journée.';
  if (donnees.horairesDifferentsParJour) {
    for (const jour of donnees.semaineType) {
      const duree = jour.statut === 'travail' ? dureeJournee(jour.heureDebut, jour.heureFin) : null;
      if (duree !== null && jour.pauseMinutes > 0 && jour.pauseMinutes >= duree) refuser(`pause:${jour.jour}`, messagePause);
    }
  } else {
    const duree = dureeJournee(donnees.heureDebutCommune, donnees.heureFinCommune);
    const aUnJourTravaille = donnees.semaineType.some((jour) => jour.statut === 'travail');
    if (aUnJourTravaille && duree !== null && donnees.pauseCommuneMinutes > 0 && donnees.pauseCommuneMinutes >= duree) refuser('pause', messagePause);
  }
  return erreurs;
}
