import BlocInfosPerso from './blocs/BlocInfosPerso';
import BlocCoordonnees from './blocs/BlocCoordonnees';

// Catalogue générique code -> composant, équivalent front de la table `blocs_disponibles`.
// Le moteur (FormulaireInscription / BlocRenderer) ne connaît que ce registre : ajouter un
// bloc réellement nouveau demande une entrée ici, mais activer/désactiver/réordonner un bloc
// existant pour une entité ne touche jamais ce fichier (voir formulaireConfig.accecit.js).
export const blocRegistry = {
  infos_perso: BlocInfosPerso,
  coordonnees: BlocCoordonnees,
};
