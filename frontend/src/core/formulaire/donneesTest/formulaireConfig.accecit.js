// Données de test locales — à remplacer par un appel API (GET config formulaire de l'entité,
// résolue via entiteContext) une fois le backend branché. Même forme que la jointure
// entite_blocs_formulaire + blocs_disponibles du schéma validé : { code, actif, ordre, config }.
export const formulaireConfigAccecitTest = [
  { code: 'infos_perso', actif: true, ordre: 1, config: {} },
  { code: 'coordonnees', actif: true, ordre: 2, config: {} },
  { code: 'disponibilites', actif: true, ordre: 3, config: {} },
  { code: 'situation_pro', actif: false, ordre: 4, config: {} },
  { code: 'provenance', actif: false, ordre: 5, config: {} },
  { code: 'consentement', actif: false, ordre: 6, config: {} },
];
