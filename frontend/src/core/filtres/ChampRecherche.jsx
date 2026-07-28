import './ChampRecherche.css';

// Champ de recherche texte générique, même langage visuel que la barre de filtres de statut
// (voir core/dossier/FiltresStatut.css) — extrait de FiltresRechercheDossiers.jsx (recherche +
// plage de dates) plutôt que d'y coupler ce composant : ce dernier reste propre aux dossiers
// (plage de dates de dernière mise à jour, spécifique à ce domaine), alors que ce champ n'a
// besoin que d'une recherche texte pure — réutilisable pour n'importe quelle liste (voir
// pages/admin/Utilisateurs.jsx). Composant purement d'affichage : aucune logique de filtrage
// ici, seulement valeur/onChanger remontés à l'appelant, comme FiltresStatut.jsx.
export default function ChampRecherche({ valeur, onChanger, placeholder, ariaLabel }) {
  return (
    <div className="champ-recherche">
      <input
        type="search"
        className="champ-recherche__champ"
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        value={valeur}
        onChange={(evenement) => onChanger(evenement.target.value)}
      />
    </div>
  );
}
