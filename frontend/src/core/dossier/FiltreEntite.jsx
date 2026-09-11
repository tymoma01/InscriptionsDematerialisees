import './FiltreEntite.css';

// Filtre "Entité" (Hôtellerie/Tertiaire) — extrait de TableauDeBordAccueil.jsx (Dossiers
// candidats, audit 2026-08-25) pour être réutilisé tel quel par tout écran back-office qui liste
// des dossiers candidats (Suivi des tests/Suivi des formations, voir leurs pages respectives) :
// deux boutons indépendamment activables (Set, pas un choix exclusif comme les statuts de
// FiltresStatut.jsx), jamais d'option "Toutes" dédiée (ferait doublon avec le bouton "Tous" déjà
// porté par FiltresStatut, à qui ce composant est destiné à être passé via sa prop
// `filtresSupplementaires`). Composant purement d'affichage, aucune logique de filtrage ici : la
// page appelante reste seule responsable du state (`entitesFiltre`/`basculerEntiteFiltre`, voir
// useEnsembleURL) et du calcul des compteurs (voir compteurHotel/compteurBureau plus bas) — ceux-ci
// doivent refléter la liste FILTRÉE par tous les AUTRES critères déjà actifs sur l'écran appelant
// (recherche, dates, statut, expérience, formateur...), jamais un total global recalculé ici.
export default function FiltreEntite({ entitesFiltre, onBasculerEntite, compteurHotel, compteurBureau }) {
  return (
    <div className="filtre-entite" role="group" aria-label="Filtrer par entité">
      <button
        type="button"
        data-entite="hotel"
        className={entitesFiltre.has('hotel') ? 'actif' : ''}
        aria-pressed={entitesFiltre.has('hotel')}
        onClick={() => onBasculerEntite('hotel')}
      >
        Hôtellerie <strong>({compteurHotel})</strong>
      </button>
      <button
        type="button"
        data-entite="bureau"
        className={entitesFiltre.has('bureau') ? 'actif' : ''}
        aria-pressed={entitesFiltre.has('bureau')}
        onClick={() => onBasculerEntite('bureau')}
      >
        Tertiaire <strong>({compteurBureau})</strong>
      </button>
    </div>
  );
}
