import logoAccecit from '../../assets/logo-accecit-fonce.png';
import './FiligraneFormulaire.css';

// Répétitions du logo dans les marges gauche/droite, réparties à parts égales sur la plage
// verticale --filigrane-plage (voir FiligraneFormulaire.css : du bas de l'en-tête fixe jusqu'au
// bas de l'écran, avec un peu de respiration aux deux bouts) — le premier logo démarre donc juste
// sous l'en-tête plutôt qu'à 12,5% de la hauteur totale de l'écran (qui laissait un grand vide en
// haut une fois l'en-tête pris en compte), et l'écart entre chaque répétition grandit d'autant
// (répartition sur les bords de la plage — 0/33,33/66,67/100% — plutôt que sur ses quarts
// centrés). `top` cible le milieu de chaque logo, pas son bord supérieur (voir
// `transform: translateY(-50%)` dans FiligraneFormulaire.css). Les deux côtés partagent les
// mêmes hauteurs pour rester alignés l'un avec l'autre. Masqué sous 1440px via CSS (voir
// FiligraneFormulaire.css) : en dessous de ce seuil, la marge devient trop étroite pour laisser
// respirer le motif sans frôler le formulaire.
const DEBUT_PLAGE = 'calc(var(--hauteur-entete, 8rem) + 56px)';
// Fractions écrites en dur (pas de division flottante JS) pour rester lisibles dans le calc()
// généré : 0, 1/3, 2/3 et 1 arrondis à 4 décimales.
const FRACTIONS = ['0', '0.3333', '0.6667', '1'];
const HAUTEURS = FRACTIONS.map((fraction) => `calc(${DEBUT_PLAGE} + var(--filigrane-plage) * ${fraction})`);
const REPETITIONS = HAUTEURS.flatMap((haut) => [
  { cote: 'gauche', haut },
  { cote: 'droite', haut },
]);

// Filigrane purement décoratif, commun à toutes les pages du formulaire d'inscription :
// `aria-hidden` + `pointer-events: none` (voir CSS) pour rester invisible aux lecteurs d'écran
// et ne jamais intercepter de clic/tap.
export default function FiligraneFormulaire() {
  return (
    <div className="filigrane-formulaire" aria-hidden="true">
      {REPETITIONS.map((repetition, index) => (
        <img
          key={index}
          className={`filigrane-formulaire__logo filigrane-formulaire__logo--${repetition.cote}`}
          style={{ top: repetition.haut }}
          src={logoAccecit}
          alt=""
        />
      ))}
    </div>
  );
}
