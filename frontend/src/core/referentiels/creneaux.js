// Créneaux souhaités proposés à l'inscription, par secteur et dans l'ordre de la journée (même
// listes que BlocDisponibilites.schema.js).
export const CRENEAUX_HOTEL = Object.freeze(['matin', 'midi', 'soir']);
export const CRENEAUX_BUREAU = Object.freeze(['6h-9h', '9h-18h', '18h-21h']);

// Couleur de chaque créneau souhaité, associée à son CODE (jamais à son libellé) : variante du
// StatutBadge (core/workflow/StatutBadge.css). Tertiaire : 6h-9h / 9h-18h / 18h-21h ; Hôtellerie :
// matin / midi / soir.
export const VARIANTE_PAR_CRENEAU = Object.freeze({
  '6h-9h': 'bleu',
  '9h-18h': 'dore',
  '18h-21h': 'violet',
  matin: 'jaune-pale',
  midi: 'vert-eau',
  soir: 'lavande',
});

// Un créneau sans couleur définie garde le style neutre.
export function varianteCreneau(code) {
  return VARIANTE_PAR_CRENEAU[code] ?? 'neutre';
}
