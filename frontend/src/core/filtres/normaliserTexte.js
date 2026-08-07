// Retire espaces et accents pour comparer deux textes indépendamment de leur découpage en mots
// et de la saisie des diacritiques — ex. "valetdech" (sans espace) doit matcher "Valet de
// chambre", et "equipe" (sans accent) doit matcher "Chef d'équipe". normalize('NFD') décompose
// chaque caractère accentué en lettre de base + diacritique séparé (ex. "é" -> "e" + "´"), qu'il
// suffit ensuite de retirer via la plage Unicode dédiée (U+0300-U+036f). Un sur-ensemble strict de
// la comparaison brute (tout ce qu'elle trouvait, elle continue de le trouver, en plus des
// recherches où l'agent a omis espaces/accents), donc pas de comparaison "brute" à garder en
// parallèle. Partagé par tous les champs de recherche texte de l'app (voir filtrerDossiers.js,
// pages/admin/Utilisateurs.jsx) plutôt que dupliqué : une correction ici (ex. un futur cas
// d'accent non couvert) doit profiter à tous les écrans sans repasser derrière chacun.
export function normaliserTexte(valeur) {
  return valeur
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
}
