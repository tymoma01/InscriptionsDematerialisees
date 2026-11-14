// Échelons d'une demande DPAE : la correspondance poste -> échelons vient de la configuration de
// l'entité (entites.dpae_config), jamais du code. `echelons_par_poste` liste les échelons de chaque
// poste ; `postes_tous_echelons` désigne les postes (ex. « autre ») qui proposent l'ensemble des
// échelons de l'entité, sans doublon et dans l'ordre de la configuration. Un poste absent des deux
// n'a pas d'échelon.

// Configuration d'une division : la racine de `dpae_config` pour l'Hôtellerie (et toute division autre que
// le Tertiaire), la clé `tertiaire` pour le Tertiaire (échelons à renseigner dans la configuration de
// l'entité, vides tant qu'aucun n'est défini : la section « Échelon » est alors masquée). `postes` de cette
// clé : postes proposés aux demandes du Tertiaire.
function configurationDivision(entite, division) {
  const config = entite?.dpae_config ?? {};
  if (division !== 'tertiaire') return config;
  // Tertiaire : les échelons de chaque catégorie de qualification (`qualifications`) tiennent lieu de
  // correspondance poste -> échelons ; le « poste » d'une demande du Tertiaire est sa catégorie.
  const qualifications = config.tertiaire?.qualifications ?? [];
  return { echelons_par_poste: Object.fromEntries(qualifications.map((qualification) => [qualification.code, qualification.echelons ?? []])) };
}

// Catégories de qualification d'une demande du Tertiaire ; null = non configurées.
function postesTertiaire(entite) {
  const qualifications = entite?.dpae_config?.tertiaire?.qualifications;
  return qualifications ? qualifications.map((qualification) => qualification.code) : null;
}

function tousLesEchelons(parPoste) {
  return [...new Set(Object.values(parPoste).flat())];
}

// Correspondance complète poste -> échelons, postes « tous échelons » inclus.
function echelonsParPoste(entite, division) {
  const config = configurationDivision(entite, division);
  const parPoste = config.echelons_par_poste ?? {};
  const tous = tousLesEchelons(parPoste);
  const complete = { ...parPoste };
  for (const poste of config.postes_tous_echelons ?? []) complete[poste] = tous;
  return complete;
}

function echelonsDuPoste(entite, poste, division) {
  return echelonsParPoste(entite, division)[poste] ?? [];
}

// Renvoie les données avec un `echelon` cohérent avec le poste : retiré (null) si le poste n'en a
// pas, sinon obligatoire et pris dans la liste du poste. `refuser(chemin, message)` signale l'erreur.
function normaliserEchelon(entite, donnees, refuser) {
  const echelons = echelonsDuPoste(entite, donnees.poste, donnees.division);
  if (echelons.length === 0) return { ...donnees, echelon: null };
  if (!donnees.echelon) {
    refuser(['echelon'], "L'échelon est obligatoire pour ce poste.");
  } else if (!echelons.includes(donnees.echelon)) {
    refuser(['echelon'], "Cet échelon n'existe pas pour ce poste.");
  }
  return donnees;
}

module.exports = { echelonsParPoste, echelonsDuPoste, normaliserEchelon, postesTertiaire };
