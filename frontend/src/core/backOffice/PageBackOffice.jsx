import FiligraneFormulaire from '../../pages/accueil/FiligraneFormulaire';
import logoAccecit from '../../assets/logo-accecit-blanc.png';
import iconeAccecitHotellerie from '../../assets/icone-accecit-hotellerie.png';
import iconeAccecitTertiaire from '../../assets/icone-accecit-tertiaire.png';
import './PageBackOffice.css';

// Reprend la disposition du logo officiel des sous-marques (icône à gauche, nom "ACCECIT" en
// lettres espacées, séparateur fin, sous-nom en dessous) — identique à celle du formulaire
// candidat (InscriptionTablette.jsx), dupliquée ici plutôt que partagée : voir le commentaire
// d'en-tête de ce fichier pour le choix de ne pas factoriser ces deux habillages ensemble.
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

// Habillage commun aux pages back-office (accueil/coordination, recruteur, formateur, admin) :
// même langage visuel que le formulaire d'inscription candidat (en-tête sticky dégradé, filigrane
// du logo en marge, pied de page — voir InscriptionTablette.jsx/.css, PiedDePageFormulaire.jsx/.css)
// mais avec une teinte de bleu propre au back-office (--couleur-back-office, voir
// styles/variables.css), pour qu'un agent distingue l'espace interne du formulaire public en un
// coup d'œil.
//
// Dupliqué plutôt que partagé avec les composants du formulaire candidat : la divergence visuelle
// entre les deux espaces est volontaire (c'est justement le but de cette demande), pas un détail
// à factoriser derrière un prop de variante — un futur changement du formulaire candidat ne doit
// pas risquer d'affecter le back-office par inadvertance, et inversement.
//
// FiligraneFormulaire.jsx est en revanche réutilisé tel quel (pas dupliqué) : purement décoratif,
// déjà générique (ne connaît aucun contexte candidat), pilote sa position via --hauteur-entete que
// ce composant définit aussi (voir CSS) — rien à différencier pour un filigrane qui se contente de
// répéter le logo, sans dégradé de couleur associé.
//
// `children` : contenu de la page (même patron que .page-inscription-tablette__contenu côté
// candidat) — ce composant ne connaît aucun titre ni contenu propre à une page back-office
// particulière, seulement l'habillage commun.
export default function PageBackOffice({ children }) {
  return (
    <main className="page-back-office">
      <FiligraneFormulaire />
      <header className="page-back-office__entete">
        <div className="page-back-office__entete-contenu">
          <img
            className="page-back-office__logo"
            src={logoAccecit}
            alt="ACCECIT — Nettoyage à visage humain"
          />
          <div className="page-back-office__logos-marques">
            <LogoSousMarque icone={iconeAccecitHotellerie} nom="Hôtellerie" />
            <LogoSousMarque icone={iconeAccecitTertiaire} nom="Tertiaire" />
          </div>
        </div>
      </header>

      <div className="page-back-office__contenu">{children}</div>

      <footer className="page-back-office__pied-de-page">
        <div className="page-back-office__pied-de-page-contenu">
          <img className="page-back-office__pied-de-page-logo" src={logoAccecit} alt="ACCECIT" />
          <p className="page-back-office__copyright">© 2026 ACCECIT</p>
          <div className="page-back-office__coordonnees">
            <p className="page-back-office__contact">01 56 56 69 56</p>
            <p className="page-back-office__contact">47 avenue Paul Vaillant Couturier, 94250 Gentilly</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
