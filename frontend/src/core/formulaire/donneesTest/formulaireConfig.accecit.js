// Données de test locales — à remplacer par un appel API (GET config formulaire de l'entité,
// résolue via entiteContext) une fois le backend branché. Même forme que la jointure
// entite_blocs_formulaire + blocs_disponibles du schéma validé : { code, actif, etape, ordre, config }.
// `etape` regroupe les blocs qui s'affichent ensemble sur une même page du parcours (les étapes
// sont triées par cette valeur) ; `ordre` ne sert qu'à ordonner les blocs entre eux au sein
// d'une même étape. Plusieurs blocs peuvent partager la même étape (ex. infos_perso + coordonnees).
export const formulaireConfigAccecitTest = [
  { code: 'infos_perso', actif: true, etape: 1, ordre: 1, config: {} },
  { code: 'coordonnees', actif: true, etape: 1, ordre: 2, config: {} },
  { code: 'disponibilites', actif: true, etape: 1, ordre: 3, config: {} },
  { code: 'mutuelle', actif: true, etape: 2, ordre: 1, config: {} },
  { code: 'situation_pro', actif: false, etape: 3, ordre: 1, config: {} },
  { code: 'provenance', actif: false, etape: 4, ordre: 1, config: {} },
  { code: 'consentement', actif: false, etape: 5, ordre: 1, config: {} },
];
