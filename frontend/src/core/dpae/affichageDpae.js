// Affichage des colonnes des listes de demandes DPAE — source unique, partagée par « Suivi des
// demandes DPAE » (SuiviDemandesDpae.jsx), la liste RH (TraitementDpae.jsx) et la recherche/les
// filtres de ces deux listes (listeDemandesDpae.js) : ce qui est cherché ou filtré est exactement
// ce qui est affiché.

const FORMAT_DATE = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// Colonne `date` (premier jour) : le pilote PostgreSQL la renvoie comme l'instant de minuit HEURE
// LOCALE du serveur, sérialisé en UTC (ex. « 2026-09-27T22:00:00.000Z » pour le 28/09) — même
// conversion que la fiche (DetailDemandeDpae.jsx) : new Date(...) relu dans le fuseau du poste,
// jamais un découpage de la chaîne, qui afficherait la veille.
export function formaterJour(valeur) {
  return valeur ? FORMAT_DATE.format(new Date(valeur)) : '—';
}

// Sites liés (référentiel, « NOM (INITIALES) »), un libellé par site ; à défaut, ancien texte libre
// d'une demande antérieure au référentiel (colonne `hotel`). Tableau vide : aucun site renseigné.
export function libellesSites(demande) {
  const sites = demande.sites_affectation ?? [];
  if (sites.length > 0) return sites.map((site) => `${site.nom} (${site.initiales})`);
  return demande.hotel ? [demande.hotel] : [];
}

// Colonne « Site(s) d'affectation » des listes, condensée sur une ligne : CODES des sites (au plus
// SITES_AFFICHES), séparés par des virgules, et le nombre de sites restants (« AIG, CAD » + 2). Une
// demande antérieure au référentiel n'a pas de code : son ancien texte libre est repris tel quel
// (tronqué à l'affichage). Les noms complets restent dans l'info-bulle, la recherche, le filtre de
// colonne, la fiche et le PDF.
export const SITES_AFFICHES = 2;

export function sitesCondenses(demande) {
  const sites = demande.sites_affectation ?? [];
  if (sites.length === 0) return { texte: demande.hotel || '', reste: 0 };
  return {
    texte: sites.slice(0, SITES_AFFICHES).map((site) => site.initiales).join(', '),
    reste: Math.max(sites.length - SITES_AFFICHES, 0),
  };
}

// Liste complète, séparée par des virgules (info-bulle de la cellule des sites).
export function libelleSites(demande) {
  return libellesSites(demande).join(', ') || '—';
}

// Type de demande (colonne « Type » de la liste RH).
const LIBELLE_PAR_TYPE_DEMANDE = {
  nouvelle_embauche: 'Nouvelle embauche',
  prolongation: 'Prolongation',
  ajout_retrait_jours: 'Ajout/retrait de jours',
  passage_cdi: 'Passage CDI',
  changement_horaires_affectation: 'Changement horaires/affectation',
};

export function libelleTypeDemande(demande) {
  return LIBELLE_PAR_TYPE_DEMANDE[demande.type_demande] ?? demande.type_demande ?? '—';
}

export function libelleTypeContrat(demande) {
  return demande.type_contrat ? demande.type_contrat.toUpperCase() : '—';
}

export function libelleSalarie(demande) {
  return `${demande.salarie_prenom ?? ''} ${demande.salarie_nom ?? ''}`.trim();
}

export function libelleDemandeur(demande) {
  return `${demande.demandeur_prenom ?? ''} ${demande.demandeur_nom ?? ''}`.trim();
}
