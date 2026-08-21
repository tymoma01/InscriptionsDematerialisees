import logoAccecit from '../../assets/logo-accecit-blanc.png';
import iconeAccecitHotellerie from '../../assets/icone-accecit-hotellerie.png';
import iconeAccecitTertiaire from '../../assets/icone-accecit-tertiaire.png';
import './EnTeteAccecit.css';

// Reprend la disposition du logo officiel des sous-marques (icône à gauche, nom "ACCECIT" en
// lettres espacées, séparateur fin, sous-nom en dessous) — identique à celle du formulaire
// candidat (InscriptionTablette.jsx), dupliquée là-bas plutôt que partagée (voir le commentaire
// d'en-tête de PageBackOffice.jsx pour le choix de ne pas factoriser les deux habillages
// ensemble) : ce composant-ci reste propre à la teinte back-office.
function LogoSousMarque({ icone, nom }) {
  return (
    <div className="page-back-office__logo-marque">
      <img className="page-back-office__logo-marque-icone" src={icone} alt="" />
      <div className="page-back-office__logo-marque-texte">
        <span className="page-back-office__logo-marque-nom">ACCECIT</span>
        <span className="page-back-office__logo-marque-sous-nom">{nom}</span>
      </div>
    </div>
  );
}

// Bandeau ACCECIT (logo + libellés Hôtellerie/Tertiaire) — extrait de PageBackOffice.jsx (audit
// 2026-08-21) : réutilisé tel quel par Connexion.jsx, seul autre écran qui a besoin de ce même
// bandeau sans le reste de l'habillage back-office (BarreNavigation/BoutonNouvelleInscription
// dépendent tous deux d'une session déjà active, sans objet avant connexion — voir Connexion.jsx).
// Générique : ne connaît ni session ni routage, purement décoratif.
export default function EnTeteAccecit() {
  return (
    <header className="page-back-office__entete">
      <div className="page-back-office__entete-contenu">
        <img className="page-back-office__logo" src={logoAccecit} alt="ACCECIT - Nettoyage à visage humain" />
        <div className="page-back-office__logos-marques">
          <LogoSousMarque icone={iconeAccecitHotellerie} nom="Hôtellerie" />
          <LogoSousMarque icone={iconeAccecitTertiaire} nom="Tertiaire" />
        </div>
      </div>
    </header>
  );
}
