// Indicateurs du « Tableau de bord DPAE » — TOUS calculés en base (agrégats SQL), sur
// une même sélection filtrée (voir requeteBase). Toutes les fonctions prennent `bd` (knex ou
// transaction), l'entité, les filtres résolus (voir tableauDeBordDpaeService.resoudreFiltres) et,
// pour celles qui dépendent du jour, l'instant `maintenant` (paramètre plutôt que now() : même
// calcul reproductible en test, voir scripts/testTableauDeBordDpae.js).
//
// Heure de Paris partout : une date de création est ramenée à son jour parisien par
// (date_creation AT TIME ZONE 'Europe/Paris')::date, « aujourd'hui » par
// (maintenant AT TIME ZONE 'Europe/Paris')::date. date_debut/date_fin sont des colonnes `date`
// (jours calendaires saisis tels quels), comparées directement à ces jours parisiens.

const FUSEAU = 'Europe/Paris';

const JOUR_CREATION = `(d.date_creation AT TIME ZONE '${FUSEAU}')::date`;
const AUJOURDHUI = `(?::timestamptz AT TIME ZONE '${FUSEAU}')::date`;

// Sélection commune à TOUS les indicateurs : entité courante (jamais une autre), période (jour
// parisien de création, bornes incluses), puis filtres optionnels — site (id, ou 'non_reference'
// pour les anciennes demandes sans site lié), type de contrat, statut.
function requeteBase(bd, entiteId, filtres) {
  const requete = bd('demandes_dpae as d')
    .where('d.entite_id', entiteId)
    .whereRaw(`${JOUR_CREATION} BETWEEN ?::date AND ?::date`, [filtres.debut, filtres.fin]);
  if (filtres.typeContrat) requete.where('d.type_contrat', filtres.typeContrat);
  if (filtres.statut) requete.where('d.statut', filtres.statut);
  if (filtres.siteId === 'non_reference') {
    requete.whereNotExists(bd('demandes_dpae_sites as l').whereRaw('l.demande_dpae_id = d.id'));
  } else if (filtres.siteId) {
    requete.whereExists(bd('demandes_dpae_sites as l').whereRaw('l.demande_dpae_id = d.id').where('l.site_affectation_id', filtres.siteId));
  }
  return requete;
}

// Exécute `selectSql` (qui lit la CTE `base`) sur la sélection filtrée — la CTE reprend le SQL et
// les paramètres de requeteBase tels quels (une seule définition des filtres pour tout le tableau).
async function executerSurBase(bd, entiteId, filtres, selectSql, parametres = []) {
  const base = requeteBase(bd, entiteId, filtres).select('d.*').toSQL();
  const resultat = await bd.raw(`WITH base AS (${base.sql}) ${selectSql}`, [...base.bindings, ...parametres]);
  return resultat.rows;
}

const COLONNES_LISTE = `base.id, base.salarie_nom, base.salarie_prenom, base.statut, base.type_contrat,
  base.date_creation, base.date_traitement, base.date_debut, base.date_fin`;

// --- 1. À traiter en priorité ---------------------------------------------------------------------

// Demandes encore sans décision : « À traiter » ('envoyee') ET « En attente »
// ('en_attente') — une mise en attente n'est pas une décision, la demande reste prioritaire.
const SANS_DECISION = "base.statut IN ('envoyee', 'en_attente')";

// Sans décision, dont le premier jour est aujourd'hui ou demain (heure de Paris).
function listerPremierJourProche(bd, entiteId, filtres, maintenant) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT ${COLONNES_LISTE} FROM base
     WHERE ${SANS_DECISION} AND base.date_debut BETWEEN ${AUJOURDHUI} AND ${AUJOURDHUI} + 1
     ORDER BY base.date_debut, base.date_creation`,
    [maintenant, maintenant],
  );
}

// Sans décision depuis plus de 24 h (écart réel entre l'envoi et maintenant — une mise en attente ne
// remet pas ce compteur à zéro).
function listerATraiterPlus24h(bd, entiteId, filtres, maintenant) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT ${COLONNES_LISTE} FROM base
     WHERE ${SANS_DECISION} AND base.date_creation < ?::timestamptz - interval '24 hours'
     ORDER BY base.date_creation`,
    [maintenant],
  );
}

// --- 2. Activité ----------------------------------------------------------------------------------

function compterParStatut(bd, entiteId, filtres) {
  return executerSurBase(bd, entiteId, filtres, 'SELECT base.statut, count(*)::int AS nombre FROM base GROUP BY base.statut');
}

// Délai de traitement RH (envoi -> décision FINALE), en heures, sur les demandes décidées de la
// sélection. date_traitement n'est posée qu'à la validation/au rejet, jamais à une mise en attente
// (voir migration 070) : une demande passée par « En attente » compte donc de son envoi à sa décision.
async function calculerDelais(bd, entiteId, filtres) {
  const [ligne] = await executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT count(*)::int AS nombre_traitees,
            avg(extract(epoch FROM base.date_traitement - base.date_creation) / 3600)::float AS moyen_heures,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM base.date_traitement - base.date_creation) / 3600)::float AS median_heures
     FROM base WHERE base.date_traitement IS NOT NULL`,
  );
  return ligne;
}

// Évolution par semaine (lundi) ou par mois, TOUTES les périodes de l'intervalle (zéro inclus,
// generate_series), réparties par statut. Série et jours de création comparés en horodatage SANS
// fuseau (heure de Paris des deux côtés) : un date_trunc sur un `date` nu renverrait un horodatage
// avec fuseau, et la jointure dépendrait alors du fuseau de la session PostgreSQL.
function calculerEvolution(bd, entiteId, filtres, granularite) {
  const unite = granularite === 'mois' ? 'month' : 'week';
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT to_char(serie.debut, 'YYYY-MM-DD') AS periode,
            count(base.id) FILTER (WHERE base.statut = 'envoyee')::int AS envoyee,
            count(base.id) FILTER (WHERE base.statut = 'en_attente')::int AS en_attente,
            count(base.id) FILTER (WHERE base.statut = 'validee')::int AS validee,
            count(base.id) FILTER (WHERE base.statut = 'rejetee')::int AS rejetee
     FROM generate_series(date_trunc('${unite}', ?::date::timestamp), date_trunc('${unite}', ?::date::timestamp), interval '1 ${unite}') AS serie(debut)
     LEFT JOIN base ON date_trunc('${unite}', (base.date_creation AT TIME ZONE '${FUSEAU}')) = serie.debut
     GROUP BY serie.debut ORDER BY serie.debut`,
    [filtres.debut, filtres.fin],
  );
}

// --- Déclarations tardives ----------------------------------------------------------
// Indicateur de SUIVI, plus dans « À traiter en priorité » (la RH n'a plus rien à y faire) : demandes
// validées APRÈS leur premier jour — jour parisien de la décision RH postérieur au premier jour.
// retard_jours = jours calendaires entre le premier jour et le jour (Paris) de la validation (>= 1).
function listerValideesEnRetard(bd, entiteId, filtres) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT ${COLONNES_LISTE},
            ((base.date_traitement AT TIME ZONE '${FUSEAU}')::date - base.date_debut)::int AS retard_jours
     FROM base
     WHERE base.statut = 'validee' AND base.date_debut IS NOT NULL
       AND (base.date_traitement AT TIME ZONE '${FUSEAU}')::date > base.date_debut
     ORDER BY base.date_debut DESC, base.id DESC`,
  );
}

// --- 3. Répartition -------------------------------------------------------------------------------

function repartirParContrat(bd, entiteId, filtres) {
  return executerSurBase(bd, entiteId, filtres, 'SELECT base.type_contrat AS cle, count(*)::int AS nombre FROM base GROUP BY base.type_contrat');
}

// Raison du CDD, pour les CDD SEULEMENT : une raison restée d'une saisie précédente sur un CDI
// (constaté en PROD, demande 1) n'est jamais comptée.
function repartirMotifsCdd(bd, entiteId, filtres) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    "SELECT base.motif_cdd AS cle, count(*)::int AS nombre FROM base WHERE base.type_contrat = 'cdd' GROUP BY base.motif_cdd",
  );
}

// Top 10 des sites : une demande à plusieurs sites compte pour chacun d'eux.
function listerTopSites(bd, entiteId, filtres) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT s.id, s.nom, s.initiales, count(DISTINCT base.id)::int AS nombre
     FROM base
     JOIN demandes_dpae_sites l ON l.demande_dpae_id = base.id
     JOIN sites_affectation s ON s.id = l.site_affectation_id
     GROUP BY s.id, s.nom, s.initiales
     ORDER BY nombre DESC, lower(s.nom) ASC
     LIMIT 10`,
  );
}

// Anciennes demandes sans site lié (texte libre `hotel` seulement) : regroupées sous « Non référencé ».
async function compterNonReferencees(bd, entiteId, filtres) {
  const [ligne] = await executerSurBase(
    bd,
    entiteId,
    filtres,
    'SELECT count(*)::int AS nombre FROM base WHERE NOT EXISTS (SELECT 1 FROM demandes_dpae_sites l WHERE l.demande_dpae_id = base.id)',
  );
  return ligne.nombre;
}

function repartirParPoste(bd, entiteId, filtres) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    'SELECT base.poste AS cle, count(*)::int AS nombre FROM base GROUP BY base.poste ORDER BY nombre DESC',
  );
}

function repartirParDemandeur(bd, entiteId, filtres) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT u.id, u.prenom, u.nom, count(*)::int AS nombre
     FROM base JOIN utilisateurs u ON u.id = base.demandeur_id
     GROUP BY u.id, u.prenom, u.nom ORDER BY nombre DESC, lower(u.nom) ASC`,
  );
}

function repartirDejaEmploye(bd, entiteId, filtres) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    'SELECT base.salarie_deja_employe AS cle, count(*)::int AS nombre FROM base GROUP BY base.salarie_deja_employe',
  );
}

// --- 4. Anticipation ------------------------------------------------------------------------------

// CDD (non rejetés : un CDD refusé ne prendra jamais fin) dont le dernier jour tombe entre
// aujourd'hui et aujourd'hui + 15 jours (heure de Paris) ; `sous_7_jours` marque ceux des 7
// prochains jours.
function listerFinsDeCdd(bd, entiteId, filtres, maintenant) {
  return executerSurBase(
    bd,
    entiteId,
    filtres,
    `SELECT ${COLONNES_LISTE}, (base.date_fin <= ${AUJOURDHUI} + 7) AS sous_7_jours
     FROM base
     WHERE base.type_contrat = 'cdd' AND base.statut <> 'rejetee'
       AND base.date_fin BETWEEN ${AUJOURDHUI} AND ${AUJOURDHUI} + 15
     ORDER BY base.date_fin, base.salarie_nom`,
    [maintenant, maintenant, maintenant],
  );
}

module.exports = {
  requeteBase,
  listerPremierJourProche,
  listerATraiterPlus24h,
  listerValideesEnRetard,
  compterParStatut,
  calculerDelais,
  calculerEvolution,
  repartirParContrat,
  repartirMotifsCdd,
  listerTopSites,
  compterNonReferencees,
  repartirParPoste,
  repartirParDemandeur,
  repartirDejaEmploye,
  listerFinsDeCdd,
};
