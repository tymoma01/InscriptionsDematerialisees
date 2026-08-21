import { useEffect } from 'react';
import FiligraneFormulaire from '../../pages/accueil/FiligraneFormulaire';
import BoutonNouvelleInscription from './BoutonNouvelleInscription';
import BarreNavigation from './BarreNavigation';
import EnTeteAccecit from './EnTeteAccecit';
import PiedDePageAccecit from './PiedDePageAccecit';
import './PageBackOffice.css';

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
// EnTeteAccecit.jsx/PiedDePageAccecit.jsx (extraits d'ici, audit 2026-08-21) : bandeau et pied de
// page seuls, sans BarreNavigation/BoutonNouvelleInscription (tous deux dépendants d'une session
// active) — réutilisés tels quels par Connexion.jsx, seul autre écran qui a besoin de cette même
// teinte back-office sans le reste de cet habillage (avant toute connexion, une barre de
// navigation par rôle ou un bouton "Nouvelle inscription" n'auraient pas de sens).
//
// `children` : contenu de la page (même patron que .page-inscription-tablette__contenu côté
// candidat) — ce composant ne connaît aucun titre ni contenu propre à une page back-office
// particulière, seulement l'habillage commun.
export default function PageBackOffice({ children }) {
  // Pose la teinte back-office sur <body> plutôt que sur ce conteneur de page (voir
  // styles/blocFormulaire.css, .corps-back-office, pour l'explication détaillée) : le filigrane
  // (position fixed + z-index négatif) doit rester visible par-dessus le fond de <body>, ce qui ne
  // fonctionne que si AUCUN élément en flux normal entre <body> et lui ne porte de fond opaque.
  // Nettoyage au démontage : une page back-office ne reste jamais affichée en même temps qu'une
  // page candidat, mais la classe ne doit pas persister sur <body> après un changement de route.
  useEffect(() => {
    document.body.classList.add('corps-back-office');
    return () => document.body.classList.remove('corps-back-office');
  }, []);

  return (
    <main className="page-back-office">
      <FiligraneFormulaire />
      {/* Ne s'affiche que pour le rôle Accueil/Coordination (voir son propre useSession() dans
          BoutonNouvelleInscription.jsx) — monté ici une seule fois pour les 9 pages back-office
          plutôt que dupliqué dans chacune. */}
      <BoutonNouvelleInscription />
      <EnTeteAccecit />

      <div className="page-back-office__contenu">
        {/* Barre de navigation commune (Dossiers candidats/Suivi des tests/Back-office recruteur/
            Tableau de bord/Comptes utilisateurs) — auto-gating par rôle et par session, voir son
            propre commentaire d'en-tête (BarreNavigation.jsx) pour le détail, même patron que
            BoutonNouvelleInscription ci-dessus. */}
        <BarreNavigation />
        {children}
      </div>

      <PiedDePageAccecit />
    </main>
  );
}
