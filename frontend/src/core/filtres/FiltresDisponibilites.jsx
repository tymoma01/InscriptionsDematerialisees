import StatutBadge from '../workflow/StatutBadge';
import { varianteCreneau } from '../referentiels/creneaux';
import { JOURS_SEMAINE } from '../referentiels/joursSemaine';
import './FiltresDisponibilites.css';

// Pastille cliquable d'un groupe de filtres (sélection multiple) : couleurs de la variante au repos,
// fond marron plein et texte blanc une fois cochée (même classe pour tous les groupes).
// `libelleComplet` : nom accessible et infobulle quand la pastille n'affiche qu'une initiale.
function PastilleFiltre({ libelle, libelleComplet, variante, active, onBasculer }) {
  return (
    <button
      type="button"
      className={`filtres-disponibilites__pastille${active ? ' filtres-disponibilites__pastille--active' : ''}`}
      aria-pressed={active}
      aria-label={libelleComplet}
      title={libelleComplet}
      onClick={onBasculer}
    >
      <StatutBadge libelle={libelle} variante={variante} />
    </button>
  );
}

// Filtres « Créneaux souhaités » et « Jours disponibles » (déclarés par le candidat à l'inscription),
// partagés par l'historique des évaluations et Dossiers candidats. Composant d'affichage seul : la
// page choisit les créneaux proposés (`optionsCreneaux`) et applique le filtrage — un candidat
// correspond s'il a AU MOINS UN des choix cochés d'un groupe, les deux groupes se cumulant.
// `compact` : les deux groupes tiennent sur une seule ligne, jours réduits à leur initiale (L, M, M…).
export default function FiltresDisponibilites({
  optionsCreneaux,
  creneauxFiltre,
  onBasculerCreneau,
  joursFiltre,
  onBasculerJour,
  onEffacer,
  compact = false,
}) {
  return (
    <div className={`filtres-disponibilites${compact ? ' filtres-disponibilites--compact' : ''}`}>
      <div className="filtres-disponibilites__groupe-pastilles" role="group" aria-label="Créneaux souhaités">
        <span className="filtres-disponibilites__groupe-titre">Créneaux souhaités</span>
        {optionsCreneaux.map((creneau) => (
          <PastilleFiltre
            key={creneau}
            libelle={creneau}
            variante={varianteCreneau(creneau)}
            active={creneauxFiltre.has(creneau)}
            onBasculer={() => onBasculerCreneau(creneau)}
          />
        ))}
      </div>
      <div className="filtres-disponibilites__groupe-pastilles" role="group" aria-label="Jours disponibles">
        <span className="filtres-disponibilites__groupe-titre">Jours disponibles</span>
        {JOURS_SEMAINE.map((jour) => (
          <PastilleFiltre
            key={jour.code}
            libelle={compact ? jour.libelle.charAt(0) : jour.libelle}
            libelleComplet={compact ? jour.libelle : undefined}
            variante="etudiant"
            active={joursFiltre.has(jour.code)}
            onBasculer={() => onBasculerJour(jour.code)}
          />
        ))}
        <button
          type="button"
          className="filtres-disponibilites__effacer"
          disabled={creneauxFiltre.size === 0 && joursFiltre.size === 0}
          onClick={onEffacer}
        >
          Effacer
        </button>
      </div>
    </div>
  );
}
