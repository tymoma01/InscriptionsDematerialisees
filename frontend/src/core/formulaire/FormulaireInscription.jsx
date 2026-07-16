import BlocRenderer from './BlocRenderer';
import { useFormulaireInscription } from './useFormulaireInscription';

// Conteneur générique : orchestre la navigation entre blocs actifs d'une entité.
// Ne référence aucun bloc par son code — uniquement via la config reçue en prop.
export default function FormulaireInscription({ configBlocs }) {
  const {
    blocsActifs,
    blocCourant,
    etapeCourante,
    estPremiereEtape,
    estDerniereEtape,
    etapeCouranteValide,
    valeursParBloc,
    mettreAJourBloc,
    mettreAJourValidite,
    suivant,
    precedent,
  } = useFormulaireInscription(configBlocs);

  if (!blocCourant) {
    return <p>Aucun bloc de formulaire actif pour cette entité.</p>;
  }

  return (
    <div className="formulaire-inscription">
      <p className="formulaire-inscription__etapes">
        Étape {etapeCourante + 1} / {blocsActifs.length}
      </p>

      <BlocRenderer
        bloc={blocCourant}
        valeurs={valeursParBloc[blocCourant.code]}
        onChange={(valeurs) => mettreAJourBloc(blocCourant.code, valeurs)}
        onValiditeChange={(estValide) => mettreAJourValidite(blocCourant.code, estValide)}
      />

      <div className="formulaire-inscription__navigation">
        <button type="button" onClick={precedent} disabled={estPremiereEtape}>
          Précédent
        </button>
        <button type="button" onClick={suivant} disabled={estDerniereEtape || !etapeCouranteValide}>
          Suivant
        </button>
      </div>
    </div>
  );
}
