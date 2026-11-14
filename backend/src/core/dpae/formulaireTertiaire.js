// Formulaire DPAE de l'entité Tertiaire : tout ce qui le distingue de celui de l'Hôtellerie vient de la
// configuration de l'entité (`entites.dpae_config.tertiaire`, voir entite.config.json) — libellé de la date
// d'embauche, types de contrat, motifs de CDD, longueur maximale des textes, qualifications (catégories et
// échelons). Aucune liste en dur ici : seuls des repères techniques (codes de motif de remplacement)
// sont connus du code, car ils pilotent des champs obligatoires.
//
// Une demande est « du Tertiaire » quand sa division l'est (entiteDpae.js).

const CODE_MOTIF_REMPLACEMENT = 'remplacement_absent';
const LIMITE_TEXTE_PAR_DEFAUT = 100;
const MESSAGE_TYPE_DEMANDE = 'Pour le Tertiaire, seules les nouvelles embauches peuvent être demandées.';
const LIBELLE_DATE_DEBUT_PAR_DEFAUT = 'Date d’embauche (ou journée de doublon)';

// Configuration lue sur l'entité, avec des valeurs neutres si une clé manque.
function configurationTertiaire(entite) {
  const config = entite?.dpae_config?.tertiaire ?? {};
  const formulaire = config.formulaire ?? {};
  return {
    libelleDateDebut: formulaire.libelle_date_debut ?? LIBELLE_DATE_DEBUT_PAR_DEFAUT,
    typesDemande: formulaire.types_demande ?? [],
    typesContrat: formulaire.types_contrat ?? [],
    motifsCdd: formulaire.motifs_cdd ?? [],
    limiteTexte: formulaire.limite_texte ?? LIMITE_TEXTE_PAR_DEFAUT,
    qualifications: config.qualifications ?? [],
  };
}

function qualificationParCode(entite, code) {
  return configurationTertiaire(entite).qualifications.find((qualification) => qualification.code === code) ?? null;
}

// « Catégorie - Échelon » (ex. « Chef d'équipe - CE2 »). Catégorie inconnue (ancienne demande) ou absente :
// null (l'appelant affiche « – »).
function libelleQualification(entite, demande) {
  const qualification = qualificationParCode(entite, demande.categorie_qualification ?? demande.poste);
  if (!qualification) return null;
  return demande.echelon ? `${qualification.libelle} - ${demande.echelon}` : qualification.libelle;
}

function libelleMotifCdd(entite, code) {
  return configurationTertiaire(entite).motifsCdd.find((motif) => motif.code === code)?.libelle ?? null;
}

// Règles propres au Tertiaire, appliquées après la validation commune de la demande. Renvoie le premier
// message de refus (français, affiché tel quel) ou null. `donnees.poste` porte le code de la catégorie de
// qualification.
function verifierDemandeTertiaire(entite, donnees) {
  const config = configurationTertiaire(entite);
  const { limiteTexte } = config;

  // Types de demande proposés au Tertiaire (configuration) ; liste non configurée = aucune restriction.
  if (config.typesDemande.length > 0 && !config.typesDemande.some((type) => type.code === donnees.typeDemande)) {
    return MESSAGE_TYPE_DEMANDE;
  }

  if (!config.typesContrat.includes(donnees.typeContrat)) {
    return `Le type de contrat d’une demande du Tertiaire doit être : ${config.typesContrat.map((type) => type.toUpperCase()).join(' ou ')}.`;
  }
  if (donnees.typeContrat === 'cdd') {
    if (!donnees.dateFin) return 'La date de fin est obligatoire pour un CDD.';
    if (!donnees.motifCdd) return 'Le motif du CDD est obligatoire.';
    if (!config.motifsCdd.some((motif) => motif.code === donnees.motifCdd)) return 'Ce motif de CDD n’est pas proposé pour le Tertiaire.';
    if (donnees.motifCdd === CODE_MOTIF_REMPLACEMENT) {
      if (!donnees.salarieRemplaceNom) return 'Le nom du salarié remplacé est obligatoire pour un remplacement.';
      if (!donnees.motifAbsence) return 'Le motif d’absence est obligatoire pour un remplacement.';
      if (donnees.salarieRemplaceNom.length > limiteTexte) return `Le nom du salarié remplacé ne peut pas dépasser ${limiteTexte} caractères.`;
      if (donnees.motifAbsence.length > limiteTexte) return `Le motif d’absence ne peut pas dépasser ${limiteTexte} caractères.`;
    }
  }
  if (donnees.dateFin && donnees.dateDebut && donnees.dateFin < donnees.dateDebut) {
    return 'La date de fin ne peut pas précéder la date d’embauche.';
  }
  const qualification = qualificationParCode(entite, donnees.poste);
  if (!qualification) return 'Cette catégorie de qualification n’existe pas pour le Tertiaire.';
  if (qualification.echelons.length > 0) {
    if (!donnees.echelon) return 'L’échelon est obligatoire pour cette catégorie de qualification.';
    if (!qualification.echelons.includes(donnees.echelon)) return 'Cet échelon n’existe pas pour cette catégorie de qualification.';
  }
  return null;
}

// Champs d'une demande du Tertiaire absents du formulaire : valeurs neutres (le schéma commun les exige).
// Le motif d'absence n'est conservé que pour un remplacement ; la catégorie de qualification est le poste.
function normaliserDemandeTertiaire(donnees) {
  const remplacement = donnees.typeContrat === 'cdd' && donnees.motifCdd === CODE_MOTIF_REMPLACEMENT;
  const resultat = { ...donnees, categorieQualification: donnees.poste };
  if (!remplacement) {
    delete resultat.salarieRemplaceNom;
    resultat.motifAbsence = undefined;
  }
  return resultat;
}

module.exports = {
  CODE_MOTIF_REMPLACEMENT,
  configurationTertiaire,
  qualificationParCode,
  libelleQualification,
  libelleMotifCdd,
  verifierDemandeTertiaire,
  normaliserDemandeTertiaire,
};
