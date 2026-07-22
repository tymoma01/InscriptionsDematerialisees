// Espacement automatique en temps réel sur des champs numériques (NIR, téléphone) — la valeur
// affichée à l'écran comporte des espaces (lisibilité), mais la valeur réellement suivie par
// react-hook-form (et donc validée, stockée, envoyée au serveur) ne contient jamais d'espace :
// seul l'AFFICHAGE est formaté, jamais la donnée elle-même. Les regex de validation existantes
// (BlocInfosPerso.schema.js, BlocCoordonnees.schema.js, et leurs équivalents backend) tolèrent déjà
// zéro ou un espace (`\s?`) — une valeur entièrement sans espace les satisfait donc sans qu'il soit
// nécessaire d'y toucher.

// Découpe une chaîne de chiffres en groupes selon les tailles données, séparés par des espaces.
// Ex. grouperChiffres('1850578006084', [1, 2, 2, 2, 3, 3, 2]) -> '1 85 05 78 006 084'.
export function grouperChiffres(chiffres, tailles) {
  const groupes = [];
  let index = 0;
  for (const taille of tailles) {
    if (index >= chiffres.length) break;
    groupes.push(chiffres.slice(index, index + taille));
    index += taille;
  }
  return groupes.join(' ');
}

// Props à étaler sur un <input> pour un champ react-hook-form entièrement contrôlé : `value`
// affiche la version groupée de la valeur courante, `onChange` ne retient que les chiffres tapés
// (tronqués à longueurChiffresMax) et les pousse dans react-hook-form via `onChangerValeur`
// (typiquement `(chiffres) => setValue(champ, chiffres, { shouldValidate: true })`).
//
// Volontairement PAS de {...register(champ)} sur l'input qui reçoit ces props (pas de `ref` vers
// react-hook-form) : pour un champ enregistré via ref (mode « non contrôlé », le mode par défaut
// de react-hook-form), watch()/getValues() relisent la valeur directement depuis le DOM à chaque
// évaluation — donc la version AFFICHÉE (groupée par espaces) qu'on vient d'écrire dans le DOM,
// pas la valeur propre poussée via setValue juste avant. Conséquence observée : taper dans un
// AUTRE champ du même formulaire déclenche un nouveau watch() qui relit CE champ depuis le DOM,
// réinjecte ses espaces d'affichage dans la valeur réellement suivie, que grouperChiffres
// regroupe ensuite une seconde fois n'importe comment (ex. "1 85 05 78 006 084 36" redevient
// "1  8 5  05  78  00 6 "). Confirmé empiriquement (tests avec frappe réelle touche par touche,
// simulant un vrai candidat, sur un formulaire à plusieurs champs) avant d'écarter cette
// approche — un champ purement contrôlé (aucun ref vers react-hook-form) n'a pas ce problème :
// watch() lit alors uniquement la valeur poussée par setValue, jamais le DOM.
export function propsChampNumeriqueMasque({ valeurCourante, tailles, longueurChiffresMax, onChangerValeur }) {
  return {
    value: grouperChiffres(valeurCourante ?? '', tailles),
    onChange: (evenement) => {
      const chiffres = evenement.target.value.replace(/\D/g, '').slice(0, longueurChiffresMax);
      onChangerValeur(chiffres);
    },
  };
}
