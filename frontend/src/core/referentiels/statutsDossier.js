// Statuts de dossier ACCECIT partagés par plusieurs écrans.

// Statuts depuis lesquels un test peut être reprogrammé (miroir de la transition replanifier_test
// du workflow ACCECIT ; le serveur reste seul juge).
export const STATUTS_REPLANIFIABLES = [
  'test_planifie',
  'test_non_realise',
  'invalide',
  'valide_envoi_formation',
  'valide_pret_embauche',
];
