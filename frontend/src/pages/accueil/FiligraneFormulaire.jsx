import logoAccecit from '../../assets/logo-accecit-fonce.png';
import './FiligraneFormulaire.css';

// Répétitions du logo dans les marges gauche/droite, à des hauteurs volontairement irrégulières
// (écarts croissants, pas une grille) pour un rendu discret plutôt que « papier peint ». Les deux
// côtés partagent les mêmes hauteurs pour rester alignés l'un avec l'autre. Masqué sous 1400px
// via CSS (voir FiligraneFormulaire.css) : en dessous de ce seuil, la marge devient trop étroite
// pour laisser respirer le motif sans frôler le formulaire.
const HAUTEURS = ['6%', '26%', '55%', '90%'];
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
