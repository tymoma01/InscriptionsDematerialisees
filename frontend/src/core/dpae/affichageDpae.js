// Affichage des colonnes « Premier jour » et « Site(s) d'affectation » des listes de demandes DPAE
// — source unique (2026-10-02, extrait de SuiviDemandesDpae.jsx), partagée par « Suivi des demandes
// DPAE » et la liste RH (TraitementDpae.jsx).

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Colonne `date` (premier jour) : le pilote PostgreSQL la renvoie comme l'instant de minuit HEURE
// LOCALE du serveur, sérialisé en UTC (ex. « 2026-09-27T22:00:00.000Z » pour le 28/09) — même
// conversion que la fiche (DetailDemandeDpae.jsx) : new Date(...) relu dans le fuseau du poste,
// jamais un découpage de la chaîne, qui afficherait la veille.
export function formaterJour(valeur) {
  return valeur ? FORMAT_DATE.format(new Date(valeur)) : '—';
}

// Sites liés (référentiel, NOM (INITIALES)), séparés par des virgules ; à défaut, ancien texte
// libre d'une demande antérieure au référentiel (colonne `hotel`) — jamais une demande masquée
// faute de site lié.
export function libelleSites(demande) {
  const sites = demande.sites_affectation ?? [];
  if (sites.length > 0) return sites.map((site) => `${site.nom} (${site.initiales})`).join(', ');
  return demande.hotel || '—';
}
