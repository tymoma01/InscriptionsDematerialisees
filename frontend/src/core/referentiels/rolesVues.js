// Définition des rôles du point de vue de l'Admin : secteur de chaque rôle et « vue de ce rôle » (l'écran
// d'un rôle ouvert par l'Admin avec le périmètre de ce rôle). Le menu « Vues » de la barre de navigation
// (BarreNavigation.jsx) est construit uniquement à partir de cette liste : ajouter un rôle ici suffit à le
// faire apparaître. Un rôle sans `vue` n'a pas de vue distincte de l'écran de l'Admin (Planning
// Hôtellerie : mêmes écrans et mêmes dossiers que les onglets de l'Admin) et n'est pas listé.
//
// `vue` : { chemin, estActif(chemin), roleEspace?, sousOnglets? } — mêmes routes et mêmes écrans que le rôle
// lui-même ; `roleEspace` et `sousOnglets` reprennent les sous-onglets de l'espace du rôle (Formateurs).
// Les libellés sont ceux des rôles (table `roles`).

export const SECTEURS_VUES = Object.freeze([
  { code: 'hotellerie', libelle: 'Hôtellerie' },
  { code: 'tertiaire', libelle: 'Tertiaire' },
]);

export const ROLES_VUES = Object.freeze([
  {
    code: 'formateur',
    libelle: 'Formateur Hôtellerie',
    secteur: 'hotellerie',
    vue: {
      chemin: '/formateur/evaluations',
      estActif: (chemin) => chemin.startsWith('/formateur/'),
      roleEspace: 'formateur',
      sousOnglets: ['historique-evaluations', 'evaluations-a-venir'],
    },
  },
  {
    code: 'inspecteur_hotellerie',
    libelle: 'Inspecteur Hôtellerie',
    secteur: 'hotellerie',
    // Dossiers candidats avec le périmètre de ce rôle, appliqué côté serveur (paramètre `vue`, Admin seulement).
    vue: {
      chemin: '/vue-inspecteur-hotellerie/dossiers',
      estActif: (chemin) => chemin.startsWith('/vue-inspecteur-hotellerie/'),
    },
  },
  { code: 'planning', libelle: 'Planning Hôtellerie', secteur: 'hotellerie', vue: null },
  {
    code: 'inspecteur',
    libelle: 'Formateur Tertiaire',
    secteur: 'tertiaire',
    vue: {
      chemin: '/inspecteur/evaluations',
      estActif: (chemin) => chemin.startsWith('/inspecteur/'),
      roleEspace: 'inspecteur',
      sousOnglets: ['historique-evaluations', 'evaluations-a-venir'],
    },
  },
  {
    code: 'planning_tertiaire',
    libelle: 'Planning Tertiaire',
    secteur: 'tertiaire',
    // Dossiers candidats avec le périmètre Tertiaire du Planning Tertiaire (paramètre `vue`, Admin seulement).
    vue: {
      chemin: '/vue-planning-tertiaire/dossiers',
      estActif: (chemin) => chemin.startsWith('/vue-planning-tertiaire/'),
    },
  },
]);
