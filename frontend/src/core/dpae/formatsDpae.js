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

// Pause en minutes -> « 1h00 », « 0h30 ». Absente ou nulle : chaîne vide (rien n'est affiché).
export function formaterPause(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return '';
  return `${Math.floor(total / 60)}h${String(total % 60).padStart(2, '0')}`;
}

// Code du type de contrat -> libellé (« CDD », « CDI », « AVENANT »). Valeur inattendue : en
// majuscules, jamais masquée ; absente : null.
const LIBELLE_PAR_TYPE_CONTRAT = { cdd: 'CDD', cdi: 'CDI', avenant: 'AVENANT' };
export function libelleTypeContrat(code) {
  if (!code) return null;
  return LIBELLE_PAR_TYPE_CONTRAT[code] ?? String(code).toUpperCase();
}

const JOURS_DE_LA_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const LIBELLE_JOUR = Object.fromEntries(JOURS_DE_LA_SEMAINE.map((jour) => [jour, jour.charAt(0).toUpperCase() + jour.slice(1)]));
export const PAUSE_ABSENTE = '–';

// Tableau de lecture de la semaine type (fiche) : un jour travaillé par ligne, dans l'ordre de la
// semaine. Horaires « 09h30 – 16h30 », pause « 1h00 » ou « – », sites « NOM (INITIALES) » (liste, vide
// pour une demande antérieure au site par jour). `avecPause` : faux si aucun jour n'a de pause (la
// colonne n'est alors pas affichée). Même règle que le PDF (backend/src/core/dpae/pdfDemandeDpae.js).
export function lignesSemaineType(semaineType, sitesAffectation) {
  const lignes = (semaineType ?? [])
    .filter((jour) => jour.statut === 'travail')
    .sort((a, b) => JOURS_DE_LA_SEMAINE.indexOf(a.jour) - JOURS_DE_LA_SEMAINE.indexOf(b.jour))
    .map((jour) => ({
      cle: jour.jour,
      jour: LIBELLE_JOUR[jour.jour] ?? jour.jour,
      horaires: jour.heureDebut && jour.heureFin ? `${formaterHeure(jour.heureDebut)} – ${formaterHeure(jour.heureFin)}` : 'Non précisés',
      pause: formaterPause(jour.pauseMinutes) || PAUSE_ABSENTE,
      sites: libellesSitesJour(jour, sitesAffectation),
    }));
  return { lignes, avecPause: lignes.some((ligne) => ligne.pause !== PAUSE_ABSENTE) };
}
