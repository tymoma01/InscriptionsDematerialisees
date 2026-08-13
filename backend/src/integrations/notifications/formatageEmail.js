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

// `lieux` porte désormais trois champs structurés (migration 047 — remplace l'ancien `libelle`
// texte libre formaté à la main avec des séparateurs " | ", voir audit du 2026-08-13) :
// `adresse` (obligatoire), `metroAcces`/`instructions` (optionnels). Affiche chaque champ renseigné
// sur sa propre ligne plutôt que concaténé — seul ce générateur d'email inclut `metroAcces`/
// `instructions` en plus de l'adresse (arbitrage : SMS/.ics restent volontairement plus courts,
// voir generateurIcs.composerAdresseCourte).
//
// inclureInstructions (défaut true, voir invitationTestService.construireMessageEmail/
// notificationChangementLieuService.construireMessageEmail — l'appel candidat ne le précise pas) :
// `instructions` porte des consignes destinées au candidat qui se présente sur place ("munissez-
// vous de votre pièce d'identité", "sonnez et dites TEST") — sans objet pour un formateur/
// inspecteur, qui n'a pas à suivre ces consignes d'accueil (voir construireMessageEmailFormateur
// dans les deux fichiers ci-dessus, qui passe `{ inclureInstructions: false }`). `metroAcces` reste
// inclus dans les deux cas : utile aussi bien au candidat qu'au formateur/inspecteur pour se rendre
// sur place.
function formaterLignesLieuHtml({ adresse, metroAcces, instructions }, { inclureInstructions = true } = {}) {
  const lignes = [`Lieu : ${echapperHtml(adresse)}`];
  if (metroAcces) lignes.push(echapperHtml(metroAcces));
  if (inclureInstructions && instructions) lignes.push(echapperHtml(instructions));
  return lignes.join('<br>\n');
}

module.exports = { echapperHtml, formaterLignesLieuHtml };
