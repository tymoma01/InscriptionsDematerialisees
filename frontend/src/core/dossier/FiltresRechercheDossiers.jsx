import './FiltresRechercheDossiers.css';

// Recherche par nom/prénom/téléphone/email/poste/n° de dossier + plage de date de dernière mise
// à jour, au-dessus de la barre de filtres de statut (FiltresStatut.jsx) — même patron :
// composant purement d'affichage, aucune logique de filtrage ici (voir filtrerDossiers.js). La
// liste de dossiers étant déjà entièrement chargée en mémoire côté page appelante (voir
// TableauDeBordAccueil.jsx / Backoffice.jsx, aucune pagination serveur), le filtrage réel se fait
// là-bas (useMemo côté page), pas ici — ce composant ne fait que remonter
// recherche/dateDebutFiltre/dateFinFiltre à son parent, comme onChangerStatutFiltre le fait déjà
// pour le statut.
export default function FiltresRechercheDossiers({
  recherche,
  onChangerRecherche,
  dateDebutFiltre,
  onChangerDateDebutFiltre,
  dateFinFiltre,
  onChangerDateFinFiltre,
}) {
  return (
    <div className="filtres-recherche-dossiers">
      <input
        type="search"
        className="filtres-recherche-dossiers__recherche"
        placeholder="Rechercher un candidat (nom, prénom, téléphone, email, poste, N° dossier)"
        aria-label="Rechercher un candidat par nom, prénom, téléphone, email, poste ou n° de dossier"
        value={recherche}
        onChange={(evenement) => onChangerRecherche(evenement.target.value)}
      />
      <label className="filtres-recherche-dossiers__date">
        <span>Du</span>
        <input
          type="date"
          value={dateDebutFiltre}
          onChange={(evenement) => onChangerDateDebutFiltre(evenement.target.value)}
        />
      </label>
      <label className="filtres-recherche-dossiers__date">
        <span>Au</span>
        <input
          type="date"
          value={dateFinFiltre}
          onChange={(evenement) => onChangerDateFinFiltre(evenement.target.value)}
        />
      </label>
    </div>
  );
}
