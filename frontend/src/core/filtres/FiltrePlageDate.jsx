import './FiltrePlageDate.css';

// Paire de champs "Du"/"Au" (sélecteurs de date jj/mm/aaaa) — extraite de
// FiltresRechercheDossiers.jsx (Dossiers candidats, filtre sur la date de dernière mise à jour du
// dossier) pour être réutilisée telle quelle par Planification.jsx (Suivi des tests, filtre sur la
// date du rendez-vous) plutôt que d'être recréée à l'identique une deuxième fois — seule la
// signification de la date filtrée diffère selon la page appelante, jamais ce composant lui-même.
// Composant purement d'affichage, aucune logique de filtrage ici (voir filtrerDossiers.js /
// Planification.jsx selon la page).
export default function FiltrePlageDate({ dateDebutFiltre, onChangerDateDebutFiltre, dateFinFiltre, onChangerDateFinFiltre }) {
  return (
    <>
      <label className="filtre-plage-date">
        <span>Du</span>
        <input
          type="date"
          value={dateDebutFiltre}
          onChange={(evenement) => onChangerDateDebutFiltre(evenement.target.value)}
        />
      </label>
      <label className="filtre-plage-date">
        <span>Au</span>
        <input
          type="date"
          value={dateFinFiltre}
          onChange={(evenement) => onChangerDateFinFiltre(evenement.target.value)}
        />
      </label>
    </>
  );
}
