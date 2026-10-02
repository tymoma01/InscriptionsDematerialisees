// Formats d'affichage d'une demande DPAE (2026-10-02) — SOURCE UNIQUE côté backend (PDF,
// pdfDemandeDpae.js). MÊMES règles côté frontend pour la fiche : frontend/src/core/dpae/formatsDpae.js
// (applications construites séparément, aucun fichier partageable) — toute modification doit être
// reportée dans les deux fichiers.

// « 08:00:00 » ou « 8:00 » -> « 08h00 ». Valeur inattendue : renvoyée telle quelle (jamais masquée).
function formaterHeure(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return valeur;
  const correspondance = /^(\d{1,2}):(\d{2})/.exec(String(valeur));
  if (!correspondance) return String(valeur);
  return `${correspondance[1].padStart(2, '0')}h${correspondance[2]}`;
}

const FORMAT_NOMBRE_HEURES = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, useGrouping: false });

// « 120.00 » -> « 120 h », « 120.50 » -> « 120,5 h », « 151.67 » -> « 151,67 h » (virgule française,
// zéros inutiles retirés). Valeur non numérique : renvoyée telle quelle.
function formaterHeuresParMois(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return valeur;
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre)) return String(valeur);
  return `${FORMAT_NOMBRE_HEURES.format(nombre)} h`;
}

module.exports = { formaterHeure, formaterHeuresParMois };
