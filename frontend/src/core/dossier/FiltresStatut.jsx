import './FiltresStatut.css';

// Barre de filtres de statut, réutilisée par toutes les pages back-office qui listent des
// dossiers par statut (tableau de bord Accueil, back-office Recruteur — voir Modularité,
// CLAUDE.md : un même rendu, pas une divergence par page). Composant purement d'affichage :
// aucune logique de filtrage ici, seulement statuts/statutFiltre/onChangerStatutFiltre reçus en
// props — la page appelante reste seule responsable du comptage et du déclenchement de la requête
// filtrée (voir TableauDeBordAccueil.jsx / Backoffice.jsx).
export default function FiltresStatut({ statuts = [], statutFiltre, onChangerStatutFiltre }) {
  return (
    <nav className="filtres-statut" aria-label="Filtrer par statut">
      <div className="filtres-statut__tous">
        <button
          type="button"
          className={statutFiltre === null ? 'actif' : ''}
          onClick={() => onChangerStatutFiltre(null)}
        >
          Tous
        </button>
      </div>
      <div className="filtres-statut__statuts">
        {statuts.map((statut) => (
          <button
            key={statut.code}
            type="button"
            className={statutFiltre === statut.code ? 'actif' : ''}
            onClick={() => onChangerStatutFiltre(statut.code)}
          >
            {statut.libelle}
          </button>
        ))}
      </div>
    </nav>
  );
}
