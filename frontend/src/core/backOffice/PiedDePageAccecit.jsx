import logoAccecit from '../../assets/logo-accecit-blanc.png';
import { COORDONNEES_ACCECIT } from './coordonneesAccecit';
import './PiedDePageAccecit.css';

// Pied de page ACCECIT (logo, copyright, coordonnées) — extrait de PageBackOffice.jsx (audit
// 2026-08-21) : réutilisé tel quel par Connexion.jsx, même raison que EnTeteAccecit.jsx (voir son
// commentaire d'en-tête). Générique : ne connaît ni session ni routage, purement décoratif.
// Coordonnées : core/backOffice/coordonneesAccecit.js (source unique, 2026-10-02).
export default function PiedDePageAccecit() {
  return (
    <footer className="page-back-office__pied-de-page">
      <div className="page-back-office__pied-de-page-contenu">
        <img className="page-back-office__pied-de-page-logo" src={logoAccecit} alt="ACCECIT" />
        <p className="page-back-office__copyright">© 2026 ACCECIT</p>
        <div className="page-back-office__coordonnees">
          <p className="page-back-office__contact">{COORDONNEES_ACCECIT.telephone}</p>
          <p className="page-back-office__contact">{COORDONNEES_ACCECIT.adresse}</p>
        </div>
      </div>
    </footer>
  );
}
