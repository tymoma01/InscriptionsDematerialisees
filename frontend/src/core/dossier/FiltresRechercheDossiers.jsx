import FiltrePlageDate from '../filtres/FiltrePlageDate';
import './FiltresRechercheDossiers.css';

// Recherche + plage de date, réutilisée par tout écran back-office qui liste des dossiers/
// rendez-vous (Dossiers candidats, Suivi des tests, Suivi des formations — demande utilisateur
// d'harmonisation, audit 2026-09-11) : composant purement d'affichage, aucune logique de filtrage
// ici (voir filtrerDossiers.js/rechercheCorrespond selon la page appelante). La liste étant déjà
// entièrement chargée en mémoire côté page appelante (aucune pagination serveur), le filtrage réel
// se fait là-bas (useMemo côté page), pas ici — ce composant ne fait que remonter
// recherche/codePostalFiltre/dateDebutFiltre/dateFinFiltre à son parent, comme onChangerStatutFiltre
// le fait déjà pour le statut. Champs "Du"/"Au" portés par FiltrePlageDate (core/filtres/), déjà
// réutilisé tel quel par plusieurs pages — voir son commentaire d'en-tête.
//
// `placeholder`/`ariaLabel` (audit 2026-09-11) : chaque page cherche sur un vocabulaire différent
// (Dossiers candidats a un téléphone/email à chercher, contrairement à Suivi des tests/Suivi des
// formations, voir leur propre rechercheCorrespond) — valeur par défaut = comportement historique
// de Dossiers candidats, premier et seul appelant avant cet audit, pour ne rien changer là où
// aucune prop n'est passée.
//
// Code postal : champ dédié, retiré de la recherche générale `q` sur Dossiers candidats (audit
// code postal) — même comportement "commence par" qu'avant. Optionnel (rendu seulement si
// `onChangerCodePostalFiltre` est fourni) : Suivi des tests/Suivi des formations n'ont pas ce
// filtre, seule Dossiers candidats l'utilise aujourd'hui — pas question de l'ajouter ailleurs en
// silence à l'occasion de cette seule harmonisation visuelle.
export default function FiltresRechercheDossiers({
  recherche,
  onChangerRecherche,
  placeholder = 'Rechercher un candidat (nom, prénom, téléphone, email, poste, statut, N° dossier)',
  ariaLabel = 'Rechercher un candidat par nom, prénom, téléphone, email, poste, statut ou n° de dossier',
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
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={recherche}
        onChange={(evenement) => onChangerRecherche(evenement.target.value)}
      />
      {onChangerCodePostalFiltre && (
        <label className="filtres-recherche-dossiers__code-postal">
          <span>Code postal</span>
          <input
            type="search"
            inputMode="numeric"
            value={codePostalFiltre}
            onChange={(evenement) => onChangerCodePostalFiltre(evenement.target.value)}
          />
        </label>
      )}
      <FiltrePlageDate
        dateDebutFiltre={dateDebutFiltre}
        onChangerDateDebutFiltre={onChangerDateDebutFiltre}
        dateFinFiltre={dateFinFiltre}
        onChangerDateFinFiltre={onChangerDateFinFiltre}
      />
    </div>
  );
}
