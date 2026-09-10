// Résolution du secteur d'un dossier et des présélections par défaut (lieu, formateur/inspecteur)
// qui en découlent — extrait de ModalePlanificationTest.jsx (planification/replanification
// individuelle, audit 2026-08-27) pour être partagé avec ModaleReplanificationGroupee.jsx
// (replanification groupée, audit 2026-09-07) : les deux écrans doivent appliquer exactement la
// même règle plutôt que la dupliquer/diverger, ce qui avait laissé la replanification groupée sans
// présélection de lieu jusqu'ici.

// postesBureau/postesHotel ne sont jamais tous deux peuplés sur un même dossier (typePoste est
// soit 'bureau' soit 'hotel', voir dossierService.js) : null si le dossier n'a déclaré aucun poste,
// jamais un cas "les deux secteurs à la fois" à départager.
export function resoudreSecteurDossier(postesBureau = [], postesHotel = []) {
  if (postesBureau.length > 0) return 'bureau';
  if (postesHotel.length > 0) return 'hotel';
  return null;
}

// 'inspecteur' évalue les postes bureau, 'formateur' les postes hôtel (ROLES.INSPECTEUR/
// ROLES.FORMATEUR, voir rbac.js) — imposé aussi côté back (rendezvousService.js) : un formateur ne
// peut pas être assigné à un dossier bureau, ni un inspecteur à un dossier hôtel. `null` si le
// secteur est indéterminé, laissé au choix de l'appelant (les deux groupes restent alors proposés
// sans restriction côté ModalePlanificationTest.jsx).
export function roleImposeParSecteur(secteur) {
  if (secteur === 'bureau') return 'inspecteur';
  if (secteur === 'hotel') return 'formateur';
  return null;
}

// Lieu par défaut de l'entité pour ce secteur (lieux.par_defaut, migration 054) — `undefined` si
// aucun lieu par défaut n'est configuré pour ce secteur (aucun encore défini, ou secteur
// indéterminé) : l'appelant garde alors le champ Lieu tel quel plutôt que de le vider.
export function trouverLieuParDefaut(lieux, secteur) {
  if (!secteur) return undefined;
  return lieux.find((lieu) => lieu.secteur === secteur && lieu.par_defaut);
}

// Formateur/inspecteur par défaut de l'entité pour ce rôle (utilisateurs.par_defaut, migration
// 059) — même repli `undefined` que trouverLieuParDefaut ci-dessus si aucun n'est configuré pour ce
// rôle, ou si `roleCode` est indéterminé.
export function trouverFormateurParDefaut(formateurs, roleCode) {
  if (!roleCode) return undefined;
  return formateurs.find((formateur) => formateur.role_code === roleCode && formateur.par_defaut);
}

// Lieu par défaut d'UN formateur/inspecteur PRÉCIS (utilisateurs.lieu_par_defaut_id, migration 063,
// demande utilisateur 2026-09-10) — prioritaire côté appelant sur trouverLieuParDefaut ci-dessus
// (lieu par défaut du SECTEUR, un seul pour tout le secteur) : deux formateurs du même secteur
// peuvent ainsi chacun avoir leur propre lieu par défaut (ex. Tiana -> Hôtel du Cadran, Anni ->
// Hôtel B55, tous deux hôtel). `undefined` si `formateurId` ne résout à aucun formateur connu, si
// ce formateur n'a aucun lieu par défaut propre configuré, ou si ce lieu n'est plus dans `lieux`
// (supprimé/désactivé depuis) — l'appelant retombe alors sur trouverLieuParDefaut(lieux, secteur),
// jamais un lieu qui n'existe plus.
export function trouverLieuParDefautFormateur(formateurs, formateurId, lieux) {
  if (!formateurId) return undefined;
  const formateur = formateurs.find((candidat) => String(candidat.id) === String(formateurId));
  if (!formateur?.lieu_par_defaut_id) return undefined;
  return lieux.find((lieu) => lieu.id === formateur.lieu_par_defaut_id);
}
