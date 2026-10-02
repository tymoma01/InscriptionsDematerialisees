import StatutBadge from '../workflow/StatutBadge';

// Expérience déclarée par le candidat (bloc Disponibilités du formulaire d'inscription) — SOURCE
// UNIQUE des libellés, des codes et des couleurs (2026-10-02, extrait de TableauDeBordAccueil.jsx),
// partagée par « Dossiers candidats » (colonne + filtre) et « Suivi des tests » (colonne + filtre).
// Vocabulaire ACCECIT (mêmes codes que BlocDisponibilites.schema.js côté formulaire).
const LIBELLES_EXPERIENCE_PAR_CODE_ACCECIT = {
  aucune: "Pas d'expérience",
  plus_6_mois: 'Plus de 6 mois',
  plus_2_ans: 'Plus de 2 ans',
  plus_5_ans: 'Plus de 5 ans',
};
export const CODES_EXPERIENCE_ACCECIT = ['aucune', 'plus_6_mois', 'plus_2_ans', 'plus_5_ans'];

// '-' pour une expérience non renseignée (même affichage que la colonne de Dossiers candidats).
export function libelleExperience(code) {
  if (!code) return '-';
  return LIBELLES_EXPERIENCE_PAR_CODE_ACCECIT[code] ?? code;
}

// Variante StatutBadge par code (couleurs `--experience-*`, StatutBadge.css) — noms alignés sur les
// codes eux-mêmes ; code inconnu : variante neutre.
const VARIANTE_EXPERIENCE_PAR_CODE_ACCECIT = {
  aucune: 'experience-aucune',
  plus_6_mois: 'experience-6mois',
  plus_2_ans: 'experience-2ans',
  plus_5_ans: 'experience-5ans',
};
export function varianteExperience(code) {
  return VARIANTE_EXPERIENCE_PAR_CODE_ACCECIT[code] ?? 'neutre';
}

// Pastille colorée d'une cellule « Expérience » ; '-' si non renseignée.
export default function BadgeExperience({ code }) {
  if (!code) return '-';
  return <StatutBadge libelle={libelleExperience(code)} variante={varianteExperience(code)} />;
}
