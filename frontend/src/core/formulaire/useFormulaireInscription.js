import { useMemo, useState, useCallback } from 'react';

// Moteur générique du formulaire multi-étapes : ne connaît que la forme de la config
// (code, actif, etape, ordre) et un sac de valeurs par bloc — aucune logique propre à ACCECIT.
// Les valeurs vivent uniquement en mémoire (useState), jamais en localStorage/sessionStorage :
// certains blocs (ex. informations personnelles) portent des données sensibles (NIR).
export function useFormulaireInscription(configBlocs) {
  // Une étape peut regrouper plusieurs blocs (ex. infos_perso + coordonnees sur la même page) —
  // le regroupement se fait par la valeur `etape`, les étapes étant triées par cette valeur et
  // les blocs au sein d'une étape triés par `ordre`.
  const etapes = useMemo(() => {
    const blocsParEtape = new Map();
    for (const bloc of configBlocs) {
      if (!bloc.actif) continue;
      if (!blocsParEtape.has(bloc.etape)) blocsParEtape.set(bloc.etape, []);
      blocsParEtape.get(bloc.etape).push(bloc);
    }
    return [...blocsParEtape.entries()]
      .sort(([etapeA], [etapeB]) => etapeA - etapeB)
      .map(([etape, blocs]) => ({ etape, blocs: [...blocs].sort((a, b) => a.ordre - b.ordre) }));
  }, [configBlocs]);

  const blocsActifs = useMemo(() => etapes.flatMap((etape) => etape.blocs), [etapes]);

  const [etapeCourante, setEtapeCourante] = useState(0);
  const [valeursParBloc, setValeursParBloc] = useState({});
  const [validiteParBloc, setValiditeParBloc] = useState({});

  const etapeActuelle = etapes[etapeCourante];
  const blocsEtapeCourante = etapeActuelle ? etapeActuelle.blocs : [];
  const estPremiereEtape = etapeCourante === 0;
  const estDerniereEtape = etapeCourante === etapes.length - 1;
  // Validité de l'étape courante : tous les blocs qu'elle regroupe doivent être valides.
  const etapeCouranteValide = blocsEtapeCourante.every((bloc) => Boolean(validiteParBloc[bloc.code]));
  // Validité globale : tous les blocs actifs doivent être valides, pas seulement ceux de l'étape
  // courante (un bloc précédent reste valide même une fois démonté, mais on le revérifie ici par sûreté).
  const formulaireValide = blocsActifs.every((bloc) => Boolean(validiteParBloc[bloc.code]));

  const mettreAJourBloc = useCallback((code, valeurs) => {
    setValeursParBloc((precedent) => ({ ...precedent, [code]: valeurs }));
  }, []);

  const mettreAJourValidite = useCallback((code, estValide) => {
    setValiditeParBloc((precedent) => ({ ...precedent, [code]: estValide }));
  }, []);

  const suivant = useCallback(() => {
    if (!etapeCouranteValide) return;
    setEtapeCourante((precedent) => Math.min(precedent + 1, etapes.length - 1));
  }, [etapeCouranteValide, etapes.length]);

  const precedent = useCallback(() => {
    setEtapeCourante((precedent) => Math.max(precedent - 1, 0));
  }, []);

  return {
    etapes,
    blocsActifs,
    blocsEtapeCourante,
    etapeCourante,
    estPremiereEtape,
    estDerniereEtape,
    etapeCouranteValide,
    formulaireValide,
    valeursParBloc,
    mettreAJourBloc,
    mettreAJourValidite,
    suivant,
    precedent,
  };
}
