import FiltrePlageDate from '../filtres/FiltrePlageDate';
import './FiltresRechercheDossiers.css';

// Recherche par nom/prénom/téléphone/email/poste/statut/n° de dossier + code postal (champ séparé,
// voir ci-dessous) + plage de date de dernière mise à jour, au-dessus de la barre de filtres de
// statut (FiltresStatut.jsx) — même patron : composant purement d'affichage, aucune logique de
// filtrage ici (voir filtrerDossiers.js). La liste de dossiers étant déjà entièrement chargée en
// mémoire côté page appelante (voir TableauDeBordAccueil.jsx / Backoffice.jsx, aucune pagination
// serveur), le filtrage réel se fait là-bas (useMemo côté page), pas ici — ce composant ne fait que
// remonter recherche/codePostalFiltre/dateDebutFiltre/dateFinFiltre à son parent, comme
// onChangerStatutFiltre le fait déjà pour le statut. Champs "Du"/"Au" portés par FiltrePlageDate
// (core/filtres/), réutilisé tel quel par Planification.jsx (Suivi des tests) — voir son commentaire
// d'en-tête.
//
// Code postal : champ dédié, retiré de la recherche générale `q` (audit code postal) — même
// comportement "commence par" qu'avant, mais visible et filtrable indépendamment, à côté de Du/Au,
// plutôt que noyé dans un champ texte unique.
export default function FiltresRechercheDossiers({
  recherche,
  onChangerRecherche,
  codePostalFiltre,
  onChangerCodePostalFiltre,
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
        placeholder="Rechercher un candidat (nom, prénom, téléphone, email, poste, statut, N° dossier)"
        aria-label="Rechercher un candidat par nom, prénom, téléphone, email, poste, statut ou n° de dossier"
        value={recherche}
        onChange={(evenement) => onChangerRecherche(evenement.target.value)}
      />
      <label className="filtres-recherche-dossiers__code-postal">
        <span>Code postal</span>
        <input
          type="search"
          inputMode="numeric"
          value={codePostalFiltre}
          onChange={(evenement) => onChangerCodePostalFiltre(evenement.target.value)}
        />
      </label>
      <FiltrePlageDate
        dateDebutFiltre={dateDebutFiltre}
        onChangerDateDebutFiltre={onChangerDateDebutFiltre}
        dateFinFiltre={dateFinFiltre}
        onChangerDateFinFiltre={onChangerDateFinFiltre}
      />
    </div>
  );
}
