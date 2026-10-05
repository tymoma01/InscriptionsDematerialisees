import { STATUTS_DPAE, libelleStatutDpae } from './statutsDpae.js';

// Indicateurs CLIQUABLES du Tableau de bord DPAE (2026-10-02) : clic sur une tuile, une barre ou une
// part de graphique -> liste des demandes concernées. Pour chaque indicateur : une clé stable (état
// de la page, survit au rechargement des données quand les filtres changent), le libellé du titre de
// la section (« site CADRAN (CAD) »), le NOMBRE affiché sur l'indicateur, et les identifiants des
// demandes comptées — calculés par le serveur DANS LA MÊME REQUÊTE SQL que le nombre
// (tableauDeBordDpaeRepository.js), d'où l'égalité garantie entre les deux. Indicateurs sans liste
// (taux de rejet, délais, part) : absents d'ici, donc non cliquables. Module pur, testé par
// indicateursTableauDeBordDpae.test.js.

// Libellés de poste : mêmes que la fiche (dupliqués, convention du projet).
export const LIBELLE_PAR_POSTE = {
  femme_valet_chambre: 'Femme/Valet de chambre',
  cafetier: 'Cafetier',
  equipier: 'Équipier',
  gouvernant: 'Gouvernant(e)',
  autre: 'Autre',
};

const FORMAT_JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' });
const FORMAT_MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });

// Libellé d'une période du graphique « Évolution » (semaine du lundi, ou mois).
export function libellePeriode(periode, granularite) {
  const date = new Date(`${periode}T12:00:00`);
  return granularite === 'mois' ? FORMAT_MOIS.format(date) : `sem. du ${FORMAT_JOUR_COURT.format(date)}`;
}

export function libellePoste(poste) {
  return poste ? (LIBELLE_PAR_POSTE[poste] ?? poste) : 'Non renseigné';
}

const LIBELLE_CONTRAT = { cdd: 'CDD', cdi: 'CDI', non_renseigne: 'non renseigné' };
const LIBELLE_MOTIF = { remplacement_absent: 'Remplacement', surcroit_activite: 'Surcroît d’activité', non_renseigne: 'non renseignée' };

// Map cle -> { cle, libelle, nombre, ids }, dans l'ordre d'affichage de la page.
export function indicateursCliquables(t) {
  const indicateurs = new Map();
  const ajouter = (cle, libelle, nombre, ids) => indicateurs.set(cle, { cle, libelle, nombre: nombre ?? 0, ids: ids ?? [] });
  if (!t) return indicateurs;

  ajouter('total', 'toutes les demandes', t.activite.total, t.activite.ids);
  for (const { code, libelle } of STATUTS_DPAE) {
    ajouter(`statut:${code}`, `statut ${libelle}`, t.activite.parStatut[code], t.activite.idsParStatut?.[code]);
  }
  for (const periode of t.activite.evolution) {
    for (const { code } of STATUTS_DPAE) {
      ajouter(
        `evolution:${periode.periode}:${code}`,
        `${libelleStatutDpae(code)}, ${libellePeriode(periode.periode, t.granularite)}`,
        periode[code],
        periode[`ids_${code}`],
      );
    }
  }
  ajouter(
    'tardives',
    'validées après leur 1er jour',
    t.declarationsTardives.nombre,
    t.declarationsTardives.demandes.map((demande) => demande.id),
  );
  for (const cle of ['cdd', 'cdi', 'non_renseigne']) {
    ajouter(`contrat:${cle}`, `contrat ${LIBELLE_CONTRAT[cle]}`, t.repartition.contrats[cle], t.repartition.idsContrats?.[cle]);
  }
  for (const cle of ['remplacement_absent', 'surcroit_activite', 'non_renseigne']) {
    ajouter(`motif:${cle}`, `raison ${LIBELLE_MOTIF[cle]}`, t.repartition.motifsCdd[cle], t.repartition.idsMotifsCdd?.[cle]);
  }
  ajouter('emploi:nouveaux', 'nouveaux salariés', t.repartition.nouveauxSalaries, t.repartition.idsNouveauxSalaries);
  ajouter('emploi:deja', 'déjà travaillé chez nous', t.repartition.dejaTravailleChezNous, t.repartition.idsDejaTravailleChezNous);
  for (const site of t.repartition.sites) {
    ajouter(`site:${site.id}`, `site ${site.nom} (${site.initiales})`, site.nombre, site.ids);
  }
  ajouter('site:non_reference', 'site non référencé', t.repartition.nonReferencees, t.repartition.idsNonReferencees);
  for (const poste of t.repartition.postes) {
    ajouter(`poste:${poste.poste ?? 'non_renseigne'}`, `poste ${libellePoste(poste.poste)}`, poste.nombre, poste.ids);
  }
  for (const demandeur of t.repartition.demandeurs) {
    ajouter(`demandeur:${demandeur.id}`, `demandeur ${demandeur.prenom} ${demandeur.nom}`, demandeur.nombre, demandeur.ids);
  }
  return indicateurs;
}

// Demandes d'un indicateur, prises dans la liste complète des demandes de l'entité (GET /dpae/suivi,
// périmètre « toutes ») : exactement celles dont l'identifiant a été compté par le serveur.
export function demandesDeLIndicateur(indicateur, demandes) {
  if (!indicateur) return [];
  const ids = new Set(indicateur.ids.map(Number));
  return demandes.filter((demande) => ids.has(Number(demande.id)));
}

// Vrai si toutes les demandes de l'indicateur sont présentes dans la liste (sinon, liste à recharger :
// une demande créée entre le chargement du tableau de bord et celui de la liste).
export function listeComplete(indicateur, demandes) {
  return demandesDeLIndicateur(indicateur, demandes).length === indicateur.ids.length;
}
