import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// useState dont la valeur est portée par un paramètre de l'URL courante plutôt que par le state
// React local — même signature d'usage que useState ([valeur, definir]), pour remplacer un
// useState existant sans toucher au reste du composant appelant. Sert à persister les filtres
// d'une page (statut, recherche, dates...) au retour arrière du navigateur (CLAUDE.md, tableau de
// bord Accueil : le filtre actif ne doit pas se perdre en revenant d'une fiche dossier) :
// contrairement à un state local, la valeur survit à un démontage/remontage du composant puisque
// c'est l'URL elle-même qui fait foi à chaque rendu, jamais un state ou une ref mise en cache côté
// composant.
// `setSearchParams(..., { replace: true })` plutôt que le comportement par défaut (push) : chaque
// changement de filtre remplace l'entrée d'historique courante au lieu d'en empiler une nouvelle —
// sans quoi le bouton retour du navigateur devrait être cliqué une fois par filtre changé avant de
// quitter réellement la page (comportement attendu d'un filtre, pas d'une navigation).
// `valeurParDefaut` sert à la fois de valeur de repli quand le paramètre est absent de l'URL
// (première visite, ou lien de menu qui ne porte aucun paramètre — voir BarreNavigation.jsx,
// "Dossiers candidats") et de valeur à ne PAS écrire dans l'URL (garde les URLs par défaut
// propres, sans paramètre superflu) : c'est ce qui permet à ce lien de réinitialiser les filtres
// simplement en pointant vers une URL sans query string, sans logique de réinitialisation dédiée
// côté page.
export function useParametreURL(nom, valeurParDefaut) {
  const [searchParams, setSearchParams] = useSearchParams();
  const brut = searchParams.get(nom);
  const valeur = brut === null ? valeurParDefaut : brut;

  const definir = useCallback(
    (valeurSuivante) => {
      setSearchParams(
        (precedent) => {
          const suivant = new URLSearchParams(precedent);
          if (valeurSuivante === valeurParDefaut || valeurSuivante === null || valeurSuivante === '') {
            suivant.delete(nom);
          } else {
            suivant.set(nom, valeurSuivante);
          }
          return suivant;
        },
        { replace: true },
      );
    },
    [nom, valeurParDefaut, setSearchParams],
  );

  return [valeur, definir];
}

// Variante Set (ex. filtre "Entité" Hôtellerie/Tertiaire de TableauDeBordAccueil.jsx : plusieurs
// valeurs indépendamment activables) — sérialisée dans l'URL comme une seule valeur séparée par
// `separateur`, au-dessus de useParametreURL ci-dessus pour hériter du même comportement
// replace/valeur-par-défaut sans le dupliquer. `basculer` reproduit le même patron toggle que
// l'ancien state local (Set copié, add/delete, jamais muté en place).
export function useEnsembleURL(nom, separateur = ',') {
  const [brut, definirBrut] = useParametreURL(nom, '');
  const ensemble = useMemo(() => new Set(brut ? brut.split(separateur).filter(Boolean) : []), [brut, separateur]);

  const basculer = useCallback(
    (valeur) => {
      const suivant = new Set(ensemble);
      if (suivant.has(valeur)) suivant.delete(valeur);
      else suivant.add(valeur);
      definirBrut([...suivant].join(separateur));
    },
    [ensemble, definirBrut, separateur],
  );

  return [ensemble, basculer];
}
