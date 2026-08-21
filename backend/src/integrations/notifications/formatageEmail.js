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

// Lien vers la fiche d'évaluation du rendez-vous, inclus dans l'email formateur/inspecteur (voir
// construireMessageEmailFormateur dans invitationTestService.js/notificationChangementLieuService.js)
// — factorisé ici comme le reste de ce fichier : même construction exacte requise des deux côtés,
// une divergence (ex. un chemin qui change d'un côté et pas de l'autre) casserait silencieusement
// le lien pour l'un des deux emails. /formateur/ ou /inspecteur/ selon roleCode (voir
// pages/formateur/Evaluation.jsx et pages/inspecteur/Evaluation.jsx côté front, même distinction
// que DESTINATION_PAR_ROLE dans Connexion.jsx) — 'inspecteur' explicitement testé, tout le reste
// (notamment 'formateur') retombe sur /formateur/, jamais d'URL cassée faute de role_code connu.
// ?rendezvousId=... lu par useParametreURL côté front (ListeEvaluationsAFaire.jsx) pour surligner
// la ligne correspondante à l'arrivée — voir Evaluation.jsx.
//
// Passe systématiquement par /connexion?redirection=... plutôt que de pointer directement sur la
// page cible (audit 2026-08-21, corrige un cas constaté) : si une session DIFFÉRENTE (mauvais
// compte, rôle insuffisant) était déjà active dans le navigateur au moment du clic, un lien
// direct atterrissait sur la page cible avec CETTE session-là — "Rôle insuffisant pour cette
// action" (rbac.middleware.js), sans aucun moyen de se reconnecter depuis cet écran. Passer par
// /connexion d'abord (Connexion.jsx, déjà câblé pour lire ?redirection=) permet de se reconnecter
// avec le bon compte ; si c'est déjà le bon compte, Connexion.jsx redirige immédiatement, sans
// friction (voir son commentaire d'en-tête).
function construireLienEvaluation(frontendUrl, roleCode, rendezvousId) {
  const segmentRole = roleCode === 'inspecteur' ? 'inspecteur' : 'formateur';
  const cible = `/${segmentRole}/evaluations?rendezvousId=${encodeURIComponent(rendezvousId)}`;
  return `${frontendUrl}/connexion?redirection=${encodeURIComponent(cible)}`;
}

module.exports = { echapperHtml, formaterLignesLieuHtml, construireLienEvaluation };
