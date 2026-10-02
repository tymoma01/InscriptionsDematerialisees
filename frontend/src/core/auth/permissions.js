// Droits de l'utilisateur connecté — la matrice des permissions vit UNIQUEMENT côté serveur
// (backend/src/core/auth/permissions.js), qui envoie avec la session la liste des clés accordées
// au rôle (`utilisateur.permissions`). Le front ne sert qu'à l'affichage : le serveur revérifie
// chaque appel.
export function peut(utilisateur, cle) {
  return Boolean(utilisateur?.permissions?.includes(cle));
}

// Code du rôle Inspecteur (affiché « Inspecteur », code technique distinct de 'inspecteur') —
// utilisé pour adapter l'affichage à son périmètre, jamais pour décider d'un droit.
export const ROLE_INSPECTEUR_HOTELLERIE = 'inspecteur_hotellerie';

// Statuts de son périmètre — miroir de backend/src/core/auth/perimetreDossiers.js (serveur seul
// juge) : sert uniquement à ne pas afficher de lien vers une fiche que le serveur refuserait.
export const STATUTS_PERIMETRE_INSPECTEUR_HOTELLERIE = [
  'test_planifie',
  'valide_envoi_formation',
  'valide_pret_embauche',
  'embauche',
  'invalide',
];

// Écran d'accueil de chaque rôle (après connexion, ou quand une page lui est refusée).
const DESTINATION_PAR_ROLE = {
  formateur: '/formateur/evaluations',
  inspecteur: '/inspecteur/evaluations',
  rh: '/rh/dpae',
  inspecteur_hotellerie: '/tableau-de-bord/indicateurs',
};
const DESTINATION_PAR_DEFAUT = '/accueil/tableau-de-bord';

export function destinationDuRole(roleCode) {
  return DESTINATION_PAR_ROLE[roleCode] ?? DESTINATION_PAR_DEFAUT;
}
