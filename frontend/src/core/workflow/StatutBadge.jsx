import './StatutBadge.css';

// Badge de statut générique : ne connaît aucun code de statut propre à une entité (voir
// Modularité, CLAUDE.md) — reçoit son libellé et sa variante déjà décidés par l'appelant.
// `variante` reste volontairement une chaîne libre parmi 'neutre' | 'attente' | 'succes' |
// 'echec' plutôt qu'un champ dérivé automatiquement d'un code : la table `statuts` ne porte
// aujourd'hui que `est_final` (pas de polarité succès/échec), donc c'est à la page appelante,
// qui elle connaît le sens métier des codes de son entité (voir
// pages/accueil/TableauDeBordAccueil.jsx), de fournir la variante.
export default function StatutBadge({ libelle, variante = 'neutre' }) {
  return <span className={`statut-badge statut-badge--${variante}`}>{libelle}</span>;
}
