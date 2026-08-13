// Utilitaires partagés par invitationTestService.js et notificationChangementLieuService.js pour
// construire un corps d'email HTML (voir graphMailProvider.js, options.html) — factorisé ici
// plutôt que dupliqué dans les deux fichiers : contrairement aux petits helpers de test du projet
// (dupliqués par convention), échapperHtml touche à la sécurité du corps envoyé (valeurs venant
// de la base : nom/prénom, libellé de lieu saisi par un agent) — une divergence entre deux copies
// serait un vrai risque, pas une question de style.

// N'échappe que les caractères qui ont un sens en HTML — les valeurs viennent de champs saisis
// par un agent (nom/prénom, libellé de lieu), jamais du candidat lui-même à ce stade de l'envoi.
function echapperHtml(valeur) {
  return String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// `lieux.libelle` (migration 044) est un champ libre unique — pas de colonnes séparées
// adresse/accès/instructions : une convention (pas une contrainte du schéma) consiste à saisir
// plusieurs informations dans ce même champ, séparées par " | " (voir scripts/seedLieux.js pour
// le cas simple à un seul segment). Affiche chaque segment sur sa propre ligne plutôt que
// concaténé, quel que soit leur nombre — le premier segment (l'adresse) est préfixé "Lieu :", les
// segments suivants (accès, instructions...) sont affichés tels quels : ce générateur ne peut pas
// savoir à l'avance combien de segments une entité choisira de renseigner, ni ce qu'ils
// représentent précisément.
function formaterLignesLieuHtml(lieu) {
  const segments = String(lieu ?? '')
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const [adresse, ...complement] = segments;
  const lignes = [`Lieu : ${echapperHtml(adresse)}`, ...complement.map((segment) => echapperHtml(segment))];
  return lignes.join('<br>\n');
}

module.exports = { echapperHtml, formaterLignesLieuHtml };
