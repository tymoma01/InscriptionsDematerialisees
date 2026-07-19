import logoAccecit from '../../assets/logo-accecit-blanc.png';
import './PiedDePageFormulaire.css';

// Pied de page affiché en bas de toutes les pages du formulaire d'inscription. Volontairement
// sobre : coordonnées utiles à un candidat (téléphone, adresse), pas de liens de navigation
// marketing (« Nos prestations », « Blog »...) qui n'ont pas leur place sur un formulaire de
// candidature. Données de contact identiques à celles d'accecit.com — à sortir en configuration
// d'entité si ce projet doit un jour servir une autre agence (voir CLAUDE.md, Modularité).
export default function PiedDePageFormulaire() {
  return (
    <footer className="pied-de-page">
      <div className="pied-de-page__contenu">
        <img className="pied-de-page__logo" src={logoAccecit} alt="ACCECIT" />
        <div className="pied-de-page__coordonnees">
          <p className="pied-de-page__contact">01 56 56 69 56</p>
          <p className="pied-de-page__contact">47 avenue Paul Vaillant Couturier, 94250 Gentilly</p>
        </div>
      </div>
      <p className="pied-de-page__copyright">© 2026 ACCECIT</p>
    </footer>
  );
}
