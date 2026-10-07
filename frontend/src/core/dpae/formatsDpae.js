// Formats d'affichage d'une demande DPAE (2026-10-02) — SOURCE UNIQUE côté frontend (fiche,
// DetailDemandeDpae.jsx). MÊMES règles côté backend pour le PDF : backend/src/core/dpae/formatsDpae.js
// (applications construites séparément, aucun fichier partageable) — toute modification doit être
// reportée dans les deux fichiers.

// « 08:00:00 » ou « 8:00 » -> « 08h00 ». Valeur inattendue : renvoyée telle quelle (jamais masquée).
export function formaterHeure(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return valeur;
  const correspondance = /^(\d{1,2}):(\d{2})/.exec(String(valeur));
  if (!correspondance) return String(valeur);
  return `${correspondance[1].padStart(2, '0')}h${correspondance[2]}`;
}

const FORMAT_NOMBRE_HEURES = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, useGrouping: false });

// « 120.00 » -> « 120 h », « 120.50 » -> « 120,5 h », « 151.67 » -> « 151,67 h » (virgule française,
// zéros inutiles retirés). Valeur non numérique : renvoyée telle quelle.
export function formaterHeuresParMois(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return valeur;
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) return String(valeur);
  return `${FORMAT_NOMBRE_HEURES.format(nombre)} h`;
}

// Sites d'affectation d'un jour de la semaine type : liste des libellés « NOM (INITIALES) » des sites
// du jour (`siteIds`, cherchés par identifiant parmi les sites de la demande, dans l'ordre de la
// liste). L'ancienne forme à un seul `siteId` est lue comme une liste d'un élément. Demande antérieure
// à la saisie du site par jour, ou site introuvable : liste vide (l'appelant affiche « Non précisé »).
export function libellesSitesJour(jour, sitesAffectation) {
  const ids = jour?.siteIds ?? (jour?.siteId ? [jour.siteId] : []);
  return ids
    .map((id) => (sitesAffectation ?? []).find((site) => site.id === id))
    .filter(Boolean)
    .map((site) => `${site.nom} (${site.initiales})`);
}

// Libellé de la liste « Entité » d'une demande : « Hôtellerie » ou « Tertiaire » (codes stockés
// `hotellerie` et `tertiaire`) ; « Autre » est remplacé par la précision saisie (`divisionAutre`). Valeur
// inattendue : renvoyée telle quelle (jamais masquée) ; absente : null.
const LIBELLE_PAR_DIVISION = { hotellerie: 'Hôtellerie', tertiaire: 'Tertiaire' };
export function libelleDivision(division, divisionAutre) {
  if (!division) return null;
  if (division === 'autre') return divisionAutre || null;
  return LIBELLE_PAR_DIVISION[division] ?? division;
}
