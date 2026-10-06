// Nombre de jours calendaires d'une demande DPAE (premier jour au dernier jour INCLUS) — calcul
// seulement, jamais stocké. MÊME règle côté frontend : frontend/src/core/dpae/joursCalendaires.js
// (applications construites séparément, aucun fichier partageable) — toute modification doit être
// reportée dans les deux fichiers.

const JOUR_MS = 24 * 60 * 60 * 1000;
const FORMAT_JOUR_PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

// Jour calendaire (nombre de jours UTC depuis l'époque), indépendant de l'heure et du fuseau : une
// chaîne « AAAA-MM-JJ » est lue telle quelle ; une Date ou un instant ISO est ramené à son jour — même conversion que partout
// ailleurs dans l'application. Passer par Date.UTC évite tout décalage d'un changement d'heure.
// Une Date ou un instant ISO (colonne `date` relue par le pilote pg, minuit heure locale) est ramené
// à son jour À PARIS, comme les dates affichées du PDF (formaterDate), quel que soit le fuseau du
// serveur.
function jourCalendaire(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return null;
  if (typeof valeur === 'string') {
    const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur.trim());
    if (correspondance) return Date.UTC(Number(correspondance[1]), Number(correspondance[2]) - 1, Number(correspondance[3])) / JOUR_MS;
  }
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return null;
  const [annee, mois, jour] = FORMAT_JOUR_PARIS.format(date).split('-').map(Number);
  return Date.UTC(annee, mois - 1, jour) / JOUR_MS;
}

// (dernier jour - premier jour) + 1 ; null si l'une des dates manque ou si le dernier jour précède le
// premier.
function nombreJoursCalendaires(premierJour, dernierJour) {
  const debut = jourCalendaire(premierJour);
  const fin = jourCalendaire(dernierJour);
  if (debut === null || fin === null || fin < debut) return null;
  return Math.round(fin - debut) + 1;
}

// « 8 jours », « 1 jour ».
function libelleNombreJours(nombre) {
  return `${nombre} ${nombre > 1 ? 'jours' : 'jour'}`;
}

module.exports = { nombreJoursCalendaires, libelleNombreJours };
