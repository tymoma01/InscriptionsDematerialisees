// Échelons d'une demande DPAE : la correspondance poste -> échelons vient de la configuration de
// l'entité (entites.dpae_config), jamais du code. `echelons_par_poste` liste les échelons de chaque
// poste ; `postes_tous_echelons` désigne les postes (ex. « autre ») qui proposent l'ensemble des
// échelons de l'entité, sans doublon et dans l'ordre de la configuration. Un poste absent des deux
// n'a pas d'échelon.

function tousLesEchelons(parPoste) {
  return [...new Set(Object.values(parPoste).flat())];
}

// Correspondance complète poste -> échelons, postes « tous échelons » inclus.
function echelonsParPoste(entite) {
  const config = entite?.dpae_config ?? {};
  const parPoste = config.echelons_par_poste ?? {};
  const tous = tousLesEchelons(parPoste);
  const complete = { ...parPoste };
  for (const poste of config.postes_tous_echelons ?? []) complete[poste] = tous;
  return complete;
}

function echelonsDuPoste(entite, poste) {
  return echelonsParPoste(entite)[poste] ?? [];
}

// Renvoie les données avec un `echelon` cohérent avec le poste : retiré (null) si le poste n'en a
// pas, sinon obligatoire et pris dans la liste du poste. `refuser(chemin, message)` signale l'erreur.
function normaliserEchelon(entite, donnees, refuser) {
  const echelons = echelonsDuPoste(entite, donnees.poste);
  if (echelons.length === 0) return { ...donnees, echelon: null };
  if (!donnees.echelon) {
    refuser(['echelon'], "L'échelon est obligatoire pour ce poste.");
  } else if (!echelons.includes(donnees.echelon)) {
    refuser(['echelon'], "Cet échelon n'existe pas pour ce poste.");
  }
  return donnees;
}

module.exports = { echelonsParPoste, echelonsDuPoste, normaliserEchelon };
