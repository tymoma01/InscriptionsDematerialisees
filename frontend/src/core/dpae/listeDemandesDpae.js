import { normaliserTexte } from '../filtres/normaliserTexte.js';
import { STATUTS_DPAE, libelleStatutDpae } from './statutsDpae.js';
import { STATUTS_AVEC_URGENCE, echeanceDemande, trierParEcheance } from './urgenceDpae.js';
import {
  libelleDemandeur,
  libelleSalarie,
  libellesSites,
  libelleTypeContrat,
  libelleTypeDemande,
} from './affichageDpae.js';

// Recherche, filtres par colonne et tri des listes de demandes DPAE — SOURCE UNIQUE, partagée par
// « Suivi des demandes DPAE » et la liste RH (via FiltresListeDpae.jsx). Appliqués CÔTÉ CLIENT : les
// deux listes ne sont pas paginées (GET /api/dpae/suivi et GET /api/dpae renvoient toutes les
// demandes du périmètre, rendues en une fois). Module pur (aucune dépendance React), testé par
// listeDemandesDpae.test.js.

// Valeur d'une demande sans valeur pour une colonne à cases à cocher (ex. aucun site, contrat non
// renseigné) : proposée comme une valeur à part entière, pour pouvoir la retenir ou l'exclure.
export const VALEUR_NON_RENSEIGNEE = 'Non renseigné';

const comparateurTexte = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

// Jour local « AAAA-MM-JJ » d'un instant (fuseau du poste, comme l'affichage des dates) — comparé
// tel quel aux bornes « Du »/« Au » des sélecteurs de date.
function jourLocal(valeur) {
  if (!valeur) return null;
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return null;
  const deuxChiffres = (nombre) => String(nombre).padStart(2, '0');
  return `${date.getFullYear()}-${deuxChiffres(date.getMonth() + 1)}-${deuxChiffres(date.getDate())}`;
}

const tempsOuNull = (valeur) => (valeur ? new Date(valeur).getTime() : null);
const ou = (valeurs) => (valeurs.length > 0 ? valeurs : [VALEUR_NON_RENSEIGNEE]);
const RANG_STATUT = Object.fromEntries(STATUTS_DPAE.map((statut, rang) => [statut.code, rang]));

// Colonnes filtrables/triables. filtre : 'periode' (du … au …), 'valeurs' (cases à cocher parmi les
// valeurs présentes) ou 'texte'. cleTri : valeur comparée au tri (null : toujours en fin de liste).
export const COLONNES_DPAE = {
  date_demande: {
    filtre: 'periode',
    jour: (demande) => jourLocal(demande.date_creation),
    cleTri: (demande) => tempsOuNull(demande.date_creation),
  },
  premier_jour: {
    filtre: 'periode',
    jour: (demande) => jourLocal(demande.date_debut),
    // Même échéance que les pastilles d'urgence (premier jour à l'heure d'arrivée).
    cleTri: (demande) => echeanceDemande(demande)?.getTime() ?? null,
  },
  salarie: {
    filtre: 'texte',
    texte: (demande) => libelleSalarie(demande),
    cleTri: (demande) => `${demande.salarie_nom ?? ''} ${demande.salarie_prenom ?? ''}`.trim() || null,
  },
  sites: {
    filtre: 'valeurs',
    valeurs: (demande) => ou(libellesSites(demande)),
    cleTri: (demande) => libellesSites(demande)[0] ?? null,
  },
  type_contrat: {
    filtre: 'valeurs',
    valeurs: (demande) => [demande.type_contrat ? libelleTypeContrat(demande) : VALEUR_NON_RENSEIGNEE],
    cleTri: (demande) => (demande.type_contrat ? libelleTypeContrat(demande) : null),
  },
  type_demande: {
    filtre: 'valeurs',
    valeurs: (demande) => [libelleTypeDemande(demande)],
    cleTri: (demande) => libelleTypeDemande(demande),
  },
  demandeur: {
    filtre: 'valeurs',
    valeurs: (demande) => ou([libelleDemandeur(demande)].filter(Boolean)),
    cleTri: (demande) => libelleDemandeur(demande) || null,
  },
  statut: {
    filtre: 'valeurs',
    valeurs: (demande) => [libelleStatutDpae(demande.statut)],
    // Ordre du cycle de vie (À traiter, En attente, Validée, Rejetée), pas l'ordre alphabétique.
    cleTri: (demande) => RANG_STATUT[demande.statut] ?? null,
  },
};

// Texte comparable : minuscules, sans accents ni espaces (normaliserTexte, partagé par toutes les
// recherches de l'application).
const normaliser = (texte) => normaliserTexte(String(texte ?? '').toLowerCase());

// Recherche : salarié, sites (nom et code), demandeur, type de contrat, type de demande, n° de
// demande — insensible aux accents et à la casse. Plusieurs mots : chacun doit se retrouver dans la
// demande (dans n'importe lequel de ces champs). Un nombre seul (« 35 », « n°35 », « n° 35 », « #35 »)
// cherche le n° de demande exact, comme la recherche de Dossiers candidats pour le n° de dossier.
export function rechercherDemandes(demandes, recherche) {
  const saisie = String(recherche ?? '').trim().toLowerCase();
  if (!saisie) return demandes;

  const numero = /^(?:n\s*°|no\.?|#)?\s*(\d+)$/.exec(saisie)?.[1];
  if (numero) return demandes.filter((demande) => String(demande.id) === numero);

  const mots = saisie.split(/\s+/).map(normaliser).filter(Boolean);
  return demandes.filter((demande) => {
    const sites = (demande.sites_affectation ?? []).flatMap((site) => [site.nom, site.initiales]);
    const champs = normaliser(
      [
        libelleSalarie(demande),
        ...sites,
        demande.hotel,
        libelleDemandeur(demande),
        demande.type_contrat,
        libelleTypeDemande(demande),
        demande.id,
      ].join(' '),
    );
    return mots.every((mot) => champs.includes(mot));
  });
}

// Un filtre de colonne est actif s'il restreint réellement la liste.
export function filtreEstActif(cle, filtre) {
  if (!filtre || !COLONNES_DPAE[cle]) return false;
  switch (COLONNES_DPAE[cle].filtre) {
    case 'periode':
      return Boolean(filtre.du || filtre.au);
    case 'valeurs':
      return Array.isArray(filtre.valeurs);
    case 'texte':
      return Boolean(String(filtre.texte ?? '').trim());
    default:
      return false;
  }
}

function correspondAuFiltre(demande, cle, filtre) {
  const colonne = COLONNES_DPAE[cle];
  if (colonne.filtre === 'periode') {
    const jour = colonne.jour(demande);
    if (!jour) return false;
    if (filtre.du && jour < filtre.du) return false;
    if (filtre.au && jour > filtre.au) return false;
    return true;
  }
  if (colonne.filtre === 'valeurs') {
    // valeurs : liste des valeurs RETENUES (cases cochées) ; une demande à plusieurs valeurs
    // (plusieurs sites) est retenue si l'une d'elles l'est.
    const retenues = new Set(filtre.valeurs);
    return colonne.valeurs(demande).some((valeur) => retenues.has(valeur));
  }
  const mots = String(filtre.texte).trim().toLowerCase().split(/\s+/).map(normaliser).filter(Boolean);
  const texte = normaliser(colonne.texte(demande));
  return mots.every((mot) => texte.includes(mot));
}

// Tous les filtres actifs se combinent (ET entre colonnes).
export function filtrerParColonnes(demandes, filtres = {}) {
  const actifs = Object.entries(filtres).filter(([cle, filtre]) => filtreEstActif(cle, filtre));
  if (actifs.length === 0) return demandes;
  return demandes.filter((demande) => actifs.every(([cle, filtre]) => correspondAuFiltre(demande, cle, filtre)));
}

// Tri stable sur une colonne ; une demande sans valeur pour cette colonne reste en fin de liste
// dans les deux sens. Ne modifie pas le tableau reçu.
export function trierDemandes(demandes, tri) {
  if (!tri?.cle || !COLONNES_DPAE[tri.cle]) return demandes;
  const { cleTri } = COLONNES_DPAE[tri.cle];
  const signe = tri.sens === 'desc' ? -1 : 1;
  return [...demandes].sort((a, b) => {
    const va = cleTri(a);
    const vb = cleTri(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const comparaison = typeof va === 'number' && typeof vb === 'number' ? va - vb : comparateurTexte.compare(String(va), String(vb));
    return signe * comparaison;
  });
}

// Valeurs proposées par le filtre à cases à cocher d'une colonne : celles présentes dans la liste
// chargée, triées (« Non renseigné » en dernier ; statuts dans l'ordre du cycle de vie).
export function valeursPresentes(demandes, cle) {
  const colonne = COLONNES_DPAE[cle];
  if (colonne?.filtre !== 'valeurs') return [];
  const valeurs = [...new Set(demandes.flatMap((demande) => colonne.valeurs(demande)))];
  if (cle === 'statut') {
    const ordre = STATUTS_DPAE.map((statut) => statut.libelle);
    return valeurs.sort((a, b) => ordre.indexOf(a) - ordre.indexOf(b));
  }
  return valeurs.sort((a, b) => {
    if (a === VALEUR_NON_RENSEIGNEE) return 1;
    if (b === VALEUR_NON_RENSEIGNEE) return -1;
    return comparateurTexte.compare(a, b);
  });
}

// Tri par défaut des DEUX listes (Suivi des demandes DPAE et liste RH), à l'ouverture et après
// « Effacer les filtres » ou le retrait d'un tri de colonne :
//   1. groupes de statut dans l'ordre du cycle de vie : À traiter, En attente, Validée, Rejetée
//      (statut inconnu : après ces quatre groupes) ;
//   2. « À traiter » et « En attente » : échéance croissante — premier jour à l'heure d'arrivée,
//      demandes en retard (échéance passée) en tête du groupe, sans premier jour en fin de groupe
//      (trierParEcheance, même calcul que les pastilles d'urgence) ;
//   3. « Validée » et « Rejetée » : date de la demande décroissante (la plus récente d'abord).
// Une seule pastille de statut sélectionnée (liste RH) : un seul groupe, sa règle s'applique.
// Tri stable, sans effet de bord sur la liste reçue.
export function trierParDefaut(demandes) {
  const parGroupe = new Map();
  for (const demande of demandes) {
    const rang = RANG_STATUT[demande.statut] ?? STATUTS_DPAE.length;
    if (!parGroupe.has(rang)) parGroupe.set(rang, []);
    parGroupe.get(rang).push(demande);
  }
  return [...parGroupe.keys()]
    .sort((a, b) => a - b)
    .flatMap((rang) => {
      const groupe = parGroupe.get(rang);
      if (STATUTS_AVEC_URGENCE.includes(STATUTS_DPAE[rang]?.code)) return trierParEcheance(groupe);
      return trierDemandes(groupe, { cle: 'date_demande', sens: 'desc' });
    });
}

// Liste affichée : recherche, puis filtres de colonnes, puis tri — le tri choisi depuis un titre de
// colonne, sinon le tri par défaut ci-dessus.
export function appliquerRechercheFiltresTri(demandes, { recherche = '', filtres = {}, tri = null } = {}) {
  const filtrees = filtrerParColonnes(rechercherDemandes(demandes, recherche), filtres);
  return tri?.cle ? trierDemandes(filtrees, tri) : trierParDefaut(filtrees);
}
