// Champs d'une demande DPAE saisis par le demandeur : table UNIQUE qui relie chaque champ de l'API
// (camelCase, voir demandeBaseSchema dans dpae.routes.js) à sa colonne de `demandes_dpae` et à la
// conversion appliquée avant écriture. Elle sert à la création (colonnesDepuisDonnees), à la
// modification (même conversion) et à la trace d'audit d'une modification (champsModifies : noms
// des champs qui diffèrent, jamais leurs valeurs — données personnelles).
//
// Ne figurent JAMAIS ici le demandeur, l'entité, la date de création, le statut et la version : ils
// ne sont pas modifiables par le client. Les sites d'affectation (table de liaison) sont traités
// à part (siteAffectationRepository, champ `sitesAffectationIds`).

const nullSiVide = (valeur) => valeur || null;

// nature : sert à comparer l'ancienne valeur lue en base et la nouvelle valeur saisie (formes
// différentes pour une même donnée : Date/chaîne, 'HH:MM:SS'/'HH:MM', décimal en chaîne, jsonb).
const CHAMPS = [
  { champ: 'typeDemande', colonne: 'type_demande', nature: 'texte', valeur: (d) => d.typeDemande },
  { champ: 'salarieNom', colonne: 'salarie_nom', nature: 'texte', valeur: (d) => d.salarieNom },
  { champ: 'salariePrenom', colonne: 'salarie_prenom', nature: 'texte', valeur: (d) => d.salariePrenom },
  { champ: 'salarieTelephone', colonne: 'salarie_telephone', nature: 'texte', valeur: (d) => nullSiVide(d.salarieTelephone) },
  { champ: 'salarieDejaEmploye', colonne: 'salarie_deja_employe', nature: 'booleen', valeur: (d) => d.salarieDejaEmploye },
  { champ: 'candidatId', colonne: 'candidat_id', nature: 'texte', valeur: (d) => nullSiVide(d.candidatId) },
  // Ancien texte libre : seulement s'il est fourni. Un client qui ne l'envoie pas (le formulaire
  // actuel) ne l'efface donc jamais sur une demande antérieure au référentiel de sites.
  { champ: 'hotel', colonne: 'hotel', nature: 'texte', facultatif: true, valeur: (d) => nullSiVide(d.hotel) },
  { champ: 'typeContrat', colonne: 'type_contrat', nature: 'texte', valeur: (d) => nullSiVide(d.typeContrat) },
  { champ: 'motifCdd', colonne: 'motif_cdd', nature: 'texte', valeur: (d) => nullSiVide(d.motifCdd) },
  { champ: 'salarieRemplaceNom', colonne: 'salarie_remplace_nom', nature: 'texte', valeur: (d) => nullSiVide(d.salarieRemplaceNom) },
  { champ: 'dateFinAbsence', colonne: 'date_fin_absence', nature: 'date', valeur: (d) => nullSiVide(d.dateFinAbsence) },
  { champ: 'raisonSurcroit', colonne: 'raison_surcroit', nature: 'texte', valeur: (d) => nullSiVide(d.raisonSurcroit) },
  { champ: 'division', colonne: 'division', nature: 'texte', valeur: (d) => nullSiVide(d.division) },
  { champ: 'divisionAutre', colonne: 'division_autre', nature: 'texte', valeur: (d) => nullSiVide(d.divisionAutre) },
  { champ: 'poste', colonne: 'poste', nature: 'texte', valeur: (d) => nullSiVide(d.poste) },
  { champ: 'posteAutre', colonne: 'poste_autre', nature: 'texte', valeur: (d) => nullSiVide(d.posteAutre) },
  { champ: 'dateDebut', colonne: 'date_debut', nature: 'date', valeur: (d) => nullSiVide(d.dateDebut) },
  { champ: 'dateFin', colonne: 'date_fin', nature: 'date', valeur: (d) => nullSiVide(d.dateFin) },
  { champ: 'heureArriveeJ1', colonne: 'heure_arrivee_j1', nature: 'heure', valeur: (d) => nullSiVide(d.heureArriveeJ1) },
  { champ: 'heuresParMois', colonne: 'heures_par_mois', nature: 'decimal', valeur: (d) => d.heuresParMois ?? null },
  { champ: 'modificationsDemandees', colonne: 'modifications_demandees', nature: 'booleen', valeur: (d) => Boolean(d.modificationsDemandees) },
  { champ: 'modificationHoraires', colonne: 'modification_horaires', nature: 'booleen', valeur: (d) => Boolean(d.modificationHoraires) },
  { champ: 'modificationJoursRepos', colonne: 'modification_jours_repos', nature: 'booleen', valeur: (d) => Boolean(d.modificationJoursRepos) },
  { champ: 'modificationAffectation', colonne: 'modification_affectation', nature: 'booleen', valeur: (d) => Boolean(d.modificationAffectation) },
  { champ: 'nouvelleAffectation', colonne: 'nouvelle_affectation', nature: 'texte', valeur: (d) => nullSiVide(d.nouvelleAffectation) },
  { champ: 'typeChangementJours', colonne: 'type_changement_jours', nature: 'texte', valeur: (d) => nullSiVide(d.typeChangementJours) },
  { champ: 'joursConcernes', colonne: 'jours_concernes', nature: 'json', valeur: (d) => JSON.stringify(d.joursConcernes ?? []) },
  { champ: 'raisonChangementJours', colonne: 'raison_changement_jours', nature: 'texte', valeur: (d) => nullSiVide(d.raisonChangementJours) },
  { champ: 'raisonIdentiqueContrat', colonne: 'raison_identique_contrat', nature: 'texte', valeur: (d) => nullSiVide(d.raisonIdentiqueContrat) },
  { champ: 'semaineType', colonne: 'semaine_type', nature: 'json', valeur: (d) => JSON.stringify(d.semaineType ?? []) },
  { champ: 'horairesDifferentsParJour', colonne: 'horaires_differents_par_jour', nature: 'booleen', valeur: (d) => Boolean(d.horairesDifferentsParJour) },
  { champ: 'autreChoseSignaler', colonne: 'autre_chose_signaler', nature: 'texte', valeur: (d) => nullSiVide(d.autreChoseSignaler) },
  { champ: 'verifBesoinHotel', colonne: 'verif_besoin_hotel', nature: 'booleen', valeur: (d) => Boolean(d.verifBesoinHotel) },
  { champ: 'verifTousJoursInclus', colonne: 'verif_tous_jours_inclus', nature: 'booleen', valeur: (d) => Boolean(d.verifTousJoursInclus) },
  { champ: 'verifNonPlanification', colonne: 'verif_non_planification', nature: 'booleen', valeur: (d) => Boolean(d.verifNonPlanification) },
];

const estConcerne = (champ, donnees) => !(champ.facultatif && donnees.hotel === undefined);

// Colonnes à écrire (création et modification), avec la conversion de chaque champ.
function colonnesDepuisDonnees(donnees) {
  return Object.fromEntries(CHAMPS.filter((champ) => estConcerne(champ, donnees)).map((champ) => [champ.colonne, champ.valeur(donnees)]));
}

// JSON canonique (clés triées) : jsonb ne conserve pas l'ordre des clés d'un objet.
function canonique(valeur) {
  if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(',')}]`;
  if (valeur && typeof valeur === 'object') {
    return `{${Object.keys(valeur)
      .sort()
      .map((cle) => `${JSON.stringify(cle)}:${canonique(valeur[cle])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valeur ?? null);
}

const deuxChiffres = (nombre) => String(nombre).padStart(2, '0');

// Valeur lue en base ou valeur à écrire, ramenée à une forme comparable.
function normaliser(nature, valeur) {
  if (nature === 'booleen') return Boolean(valeur);
  if (valeur === null || valeur === undefined || valeur === '') return nature === 'json' ? canonique([]) : null;
  switch (nature) {
    case 'decimal':
      return Number(valeur);
    case 'heure':
      return String(valeur).slice(0, 5);
    case 'date':
      // Le pilote pg renvoie une colonne `date` comme minuit heure locale : on relit les composantes
      // locales (même conversion que partout ailleurs dans l'application).
      return valeur instanceof Date
        ? `${valeur.getFullYear()}-${deuxChiffres(valeur.getMonth() + 1)}-${deuxChiffres(valeur.getDate())}`
        : String(valeur).slice(0, 10);
    case 'json':
      return canonique(typeof valeur === 'string' ? JSON.parse(valeur) : valeur);
    default:
      return String(valeur);
  }
}

// Noms (camelCase) des champs dont la valeur diffère entre la demande lue en base (`ancienne`, ligne
// de demandes_dpae) et les données saisies. Aucune valeur n'est renvoyée.
function champsModifies(ancienne, donnees) {
  return CHAMPS.filter((champ) => estConcerne(champ, donnees))
    .filter((champ) => normaliser(champ.nature, ancienne[champ.colonne]) !== normaliser(champ.nature, champ.valeur(donnees)))
    .map((champ) => champ.champ);
}

module.exports = { CHAMPS, colonnesDepuisDonnees, champsModifies };
