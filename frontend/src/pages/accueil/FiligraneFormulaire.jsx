import logoAccecit from '../../assets/logo-accecit-fonce.png';
import './FiligraneFormulaire.css';

// Répétitions du logo dans les marges gauche/droite, à des hauteurs volontairement irrégulières
// (écarts croissants, pas une grille) pour un rendu discret plutôt que « papier peint ». Masqué
// sous 1400px via CSS (voir FiligraneFormulaire.css) : en dessous de ce seuil, la marge devient
// trop étroite pour laisser respirer le motif sans frôler le formulaire.
const REPETITIONS = [
  { cote: 'gauche', haut: '6%' },
  { cote: 'gauche', haut: '26%' },
  { cote: 'gauche', haut: '55%' },
  { cote: 'gauche', haut: '90%' },
  { cote: 'droite', haut: '15%' },
  { cote: 'droite', haut: '42%' },
  { cote: 'droite', haut: '68%' },
  { cote: 'droite', haut: '95%' },
];

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
