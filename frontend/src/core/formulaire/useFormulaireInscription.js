import { useMemo, useState, useCallback } from 'react';

// Moteur générique du formulaire multi-étapes : ne connaît que la forme de la config
// (code, actif, ordre) et un sac de valeurs par bloc — aucune logique propre à ACCECIT.
// Les valeurs vivent uniquement en mémoire (useState), jamais en localStorage/sessionStorage :
// certains blocs (ex. informations personnelles) portent des données sensibles (NIR).
export function useFormulaireInscription(configBlocs) {
  const blocsActifs = useMemo(
    () =>
      [...configBlocs]
        .filter((bloc) => bloc.actif)
        .sort((a, b) => a.ordre - b.ordre),
    [configBlocs],
  );

  const [etapeCourante, setEtapeCourante] = useState(0);
  const [valeursParBloc, setValeursParBloc] = useState({});
  const [validiteParBloc, setValiditeParBloc] = useState({});

  const blocCourant = blocsActifs[etapeCourante];
  const estPremiereEtape = etapeCourante === 0;
  const estDerniereEtape = etapeCourante === blocsActifs.length - 1;
  const etapeCouranteValide = blocCourant ? Boolean(validiteParBloc[blocCourant.code]) : false;
  // Validité globale : tous les blocs actifs doivent être valides, pas seulement le courant
  // (un bloc précédent reste valide même une fois démonté, mais on le revérifie ici par sûreté).
  const formulaireValide = blocsActifs.every((bloc) => Boolean(validiteParBloc[bloc.code]));

  const mettreAJourBloc = useCallback((code, valeurs) => {
    setValeursParBloc((precedent) => ({ ...precedent, [code]: valeurs }));
  }, []);

  const mettreAJourValidite = useCallback((code, estValide) => {
    setValiditeParBloc((precedent) => ({ ...precedent, [code]: estValide }));
  }, []);

  const suivant = useCallback(() => {
    if (!etapeCouranteValide) return;
    setEtapeCourante((precedent) => Math.min(precedent + 1, blocsActifs.length - 1));
  }, [etapeCouranteValide, blocsActifs.length]);

  const precedent = useCallback(() => {
    setEtapeCourante((precedent) => Math.max(precedent - 1, 0));
  }, []);

  return {
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
  };
}
