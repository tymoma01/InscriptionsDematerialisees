import './StatutBadge.css';

// Badge de statut générique : ne connaît aucun code de statut propre à une entité (voir
// Modularité, CLAUDE.md) — reçoit son libellé et sa variante déjà décidés par l'appelant.
// `variante` reste volontairement une chaîne libre plutôt qu'un champ dérivé automatiquement
// d'un code : la table `statuts` ne porte aujourd'hui que `est_final` (pas de polarité), donc
// c'est à la page appelante, qui elle connaît le sens métier des codes de son entité (voir
// pages/accueil/TableauDeBordAccueil.jsx), de fournir la variante. Valeurs supportées (chacune
// une couleur définie dans styles/variables.css, `--statut-<variante>-*`, jamais codée en dur
// ici) : 'neutre' | 'attente' | 'succes' | 'echec' | 'bleu' | 'violet' | 'vert-clair' | 'alerte'
// | 'dore' | 'echec-fort'. Une variante inconnue de variables.css retomberait simplement sur les
// couleurs par défaut de .statut-badge (voir ci-dessous) faute de règle --statut-badge--X
// correspondante, jamais une erreur.
export default function StatutBadge({ libelle, variante = 'neutre' }) {
  return <span className={`statut-badge statut-badge--${variante}`}>{libelle}</span>;
}
