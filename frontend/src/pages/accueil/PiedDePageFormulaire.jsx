import logoAccecit from '../../assets/logo-accecit-blanc.png';
import { COORDONNEES_ACCECIT } from '../../core/backOffice/coordonneesAccecit';
import './PiedDePageFormulaire.css';

// Pied de page affiché en bas de toutes les pages du formulaire d'inscription. Volontairement
// sobre : coordonnées utiles à un candidat (téléphone, adresse), pas de liens de navigation
// marketing (« Nos prestations », « Blog »...) qui n'ont pas leur place sur un formulaire de
// candidature. Données de contact identiques à celles d'accecit.com, lues depuis
// core/backOffice/coordonneesAccecit.js (source unique, 2026-10-02) — à sortir en configuration
// d'entité si ce projet doit un jour servir une autre agence (voir CLAUDE.md, Modularité).
export default function PiedDePageFormulaire() {
  return (
    <footer className="pied-de-page">
      <div className="pied-de-page__contenu">
        <img className="pied-de-page__logo" src={logoAccecit} alt="ACCECIT" />
        <p className="pied-de-page__copyright">© 2026 ACCECIT</p>
        <div className="pied-de-page__coordonnees">
          <p className="pied-de-page__contact">{COORDONNEES_ACCECIT.telephone}</p>
          <p className="pied-de-page__contact">{COORDONNEES_ACCECIT.adresse}</p>
        </div>
      </div>
    </footer>
  );
}
