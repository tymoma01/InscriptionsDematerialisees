import { useCallback, useEffect, useRef, useState } from 'react';
import './IndicateurDefilementHorizontal.css';

// Enveloppe générique pour les conteneurs `overflow-x: auto` du back-office (audit tablette
// 2026-09-04) : `overflow-x: auto` seul ne signale jamais qu'il reste du contenu à défiler tant
// qu'on n'y a pas déjà touché — trois tableaux (DossierList.jsx/dossier-list__scroll,
// Planification.jsx/planification__scroll, Utilisateurs.jsx/table-utilisateurs__scroll)
// partageaient exactement ce même conteneur nu. Plutôt que de dupliquer la même logique de
// dégradés dans les trois, ce composant prend directement la place du `<div className="...__scroll">`
// existant : `className` reçoit la classe déjà en place (bordure/rayon/overflow-x inchangés),
// `children` le contenu (le <table>) tel quel.
//
// Dégradés posés en SIBLINGS du conteneur défilant, jamais À L'INTÉRIEUR de lui : un enfant
// absolument positionné à l'intérieur d'un ancêtre en overflow-x:auto défilerait avec le contenu
// au lieu de rester collé au bord visible. Aucun z-index posé ici (voir le commentaire de
// BoutonNouvelleInscription.css sur le risque des égalités de z-index) : simplement rendus APRÈS
// le conteneur défilant dans le DOM, ce qui suffit à les peindre par-dessus sans en avoir besoin.
export default function IndicateurDefilementHorizontal({ className, children }) {
  const refDefilement = useRef(null);
  const [peutDefilerGauche, setPeutDefilerGauche] = useState(false);
  const [peutDefilerDroite, setPeutDefilerDroite] = useState(false);

  // Tolérance de quelques px : évite un dégradé qui clignote pour un dernier pixel d'arrondi
  // sous-pixel (zoom navigateur, mise à l'échelle d'écran) une fois le défilement "au bout".
  const TOLERANCE_PX = 2;

  const recalculer = useCallback(() => {
    const noeud = refDefilement.current;
    if (!noeud) return;
    setPeutDefilerGauche(noeud.scrollLeft > TOLERANCE_PX);
    setPeutDefilerDroite(noeud.scrollLeft < noeud.scrollWidth - noeud.clientWidth - TOLERANCE_PX);
  }, []);

  useEffect(() => {
    const noeud = refDefilement.current;
    if (!noeud) return;

    recalculer();

    // Observe le conteneur ET son premier enfant (le <table>, voir children) : le conteneur seul
    // ne change jamais de taille du fait de SON contenu (c'est justement le rôle d'overflow-x:auto
    // que d'absorber ce débordement) — sans observer aussi le tableau, un changement du nombre de
    // colonnes/lignes affichées (filtres, tri) ne redéclencherait jamais ce calcul tant que la
    // fenêtre elle-même ne serait pas redimensionnée.
    const observateur = new ResizeObserver(recalculer);
    observateur.observe(noeud);
    if (noeud.firstElementChild) observateur.observe(noeud.firstElementChild);

    return () => observateur.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recalculer, children]);

  return (
    <div className="indicateur-defilement-horizontal">
      <div className={className} ref={refDefilement} onScroll={recalculer}>
        {children}
      </div>
      <div
        aria-hidden="true"
        className={`indicateur-defilement-horizontal__ombre indicateur-defilement-horizontal__ombre--gauche${
          peutDefilerGauche ? ' indicateur-defilement-horizontal__ombre--visible' : ''
        }`}
      />
      <div
        aria-hidden="true"
        className={`indicateur-defilement-horizontal__ombre indicateur-defilement-horizontal__ombre--droite${
          peutDefilerDroite ? ' indicateur-defilement-horizontal__ombre--visible' : ''
        }`}
      />
    </div>
  );
}
