import './PanneauFiltresRepliable.css';

// Bouton "Plus de filtres"/"Moins de filtres" qui révèle un panneau de filtres secondaires —
// extrait de TableauDeBordAccueil.jsx (Dossiers candidats, repli du bloc recherche/dates/expérience
// derrière ce bouton) pour être réutilisé tel quel par Suivi des tests/Suivi des formations (demande
// utilisateur d'harmonisation visuelle et fonctionnelle, audit 2026-09-11) — même style
// (positionnement, bordure en tirets, largeur) sur les trois écrans plutôt que du CSS dupliqué et
// potentiellement divergent au fil du temps.
//
// Composant purement d'affichage : `ouvert`/`onBasculer` restent portés par la page appelante — en
// particulier l'état INITIAL (ouvert au chargement si un des filtres qu'il contient est déjà actif,
// ex. lien partagé avec ?q=... ou retour arrière) ne peut être calculé qu'à cet endroit, chaque page
// connaissant seule la liste de ses propres filtres "avancés". Contenu passé en children, comme
// `filtresSupplementaires` de FiltresStatut.jsx : ce composant ne connaît rien du vocabulaire de
// filtres de la page qui l'utilise.
export default function PanneauFiltresRepliable({ ouvert, onBasculer, children }) {
  return (
    <>
      <button
        type="button"
        className="panneau-filtres-repliable__bouton"
        aria-expanded={ouvert}
        onClick={onBasculer}
      >
        {ouvert ? 'Moins de filtres ▲' : 'Plus de filtres ▼'}
      </button>
      {ouvert && <div className="panneau-filtres-repliable__panneau">{children}</div>}
    </>
  );
}
