// Nombre de jours calendaires d'une demande DPAE (premier jour au dernier jour INCLUS) — calcul
// seulement, jamais stocké. MÊME règle côté backend : backend/src/core/dpae/joursCalendaires.js
// (applications construites séparément, aucun fichier partageable) — toute modification doit être
// reportée dans les deux fichiers. Testé par joursCalendaires.test.js.

const JOUR_MS = 24 * 60 * 60 * 1000;

// Jour calendaire (nombre de jours UTC depuis l'époque), indépendant de l'heure et du fuseau : une
// chaîne « AAAA-MM-JJ » (champ de formulaire) est lue telle quelle ; une Date ou un instant ISO
// (colonne `date` renvoyée par l'API, minuit sérialisé en UTC) est ramené à son jour dans le fuseau du
// poste, comme l'affichage des dates (formaterJour). Passer par Date.UTC évite tout décalage d'un
// changement d'heure.
function jourCalendaire(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (typeof valeur === 'string') {
    const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur.trim());
    if (correspondance) return Date.UTC(Number(correspondance[1]), Number(correspondance[2]) - 1, Number(correspondance[3])) / JOUR_MS;
  }
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / JOUR_MS;
}

// (dernier jour - premier jour) + 1 ; null si l'une des dates manque ou si le dernier jour précède le
// premier.
export function nombreJoursCalendaires(premierJour, dernierJour) {
  const debut = jourCalendaire(premierJour);
  const fin = jourCalendaire(dernierJour);
  if (debut === null || fin === null || fin < debut) return null;
  return Math.round(fin - debut) + 1;
}

// « 8 jours », « 1 jour ».
export function libelleNombreJours(nombre) {
  return `${nombre} ${nombre > 1 ? 'jours' : 'jour'}`;
}
