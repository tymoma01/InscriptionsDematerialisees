// Props d'un <input type="radio"> registré via react-hook-form, mais dont la navigation
// clavier Tab visite chaque option individuellement au lieu de ne poser qu'un seul arrêt par
// groupe (comportement natif HTML : un `name` partagé entre options d'un même groupe radio fait
// que le navigateur ne pose qu'un arrêt Tab sur le groupe entier, les flèches servant alors à
// naviguer entre les options — voulu pour un lecteur d'écran, pas ici, voir la demande explicite
// qui a mené à ce choix pour le formulaire d'inscription).
//
// Pour ça, name devient unique par option (au lieu du name partagé que register() poserait),
// ce qui casse au passage l'exclusivité mutuelle et la mise à jour natives du navigateur : on
// les reprend donc à la main via `checked` (calculé sur la valeur suivie par watch()) et
// `onChange` (appelle setValue directement, plutôt que le onChange de register() qui résout en
// interne le champ modifié d'une façon qui suppose justement ce name partagé — voir le
// correctif d'origine, BlocDisponibilites.jsx, pour le détail du bug que ce contournement évite).
// `ref`/`onBlur` de register() restent utilisés : c'est ce qui garde le champ « enregistré »
// auprès de react-hook-form (et donc validé par le resolver zod), indépendamment de la valeur du
// name DOM.
//
// Un seul <input> par option porte cet appel ; chaque option d'un même groupe doit donc appeler
// cette fonction séparément (une fois par valeur possible), pas une fois pour tout le groupe.
export function propsRadioAccessible({ register, setValue, champ, valeur, valeurCourante }) {
  const { ref, onBlur } = register(champ);
  return {
    name: `${champ}-${valeur}`,
    ref,
    onBlur,
    checked: valeurCourante === valeur,
    onChange: () => setValue(champ, valeur, { shouldValidate: true }),
  };
}
