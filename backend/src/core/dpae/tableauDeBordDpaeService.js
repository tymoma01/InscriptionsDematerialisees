// « Tableau de bord DPAE » — orchestration : résout les filtres
// (période par défaut en heure de Paris), lance les agrégats SQL (tableauDeBordDpaeRepository.js,
// tous calculés en base) et assemble la réponse. Accès : Admin, RH, Planning (dpae.routes.js).

const db = require('../../db/knex');
const tableauDeBordDpaeRepository = require('./tableauDeBordDpaeRepository');
const siteAffectationRepository = require('./siteAffectationRepository');
const { CODES_STATUTS_DPAE, STATUT_VALIDEE, STATUT_REJETEE } = require('./statutsDpae');

const FUSEAU = 'Europe/Paris';
// Période par défaut : les 30 derniers jours, aujourd'hui inclus.
const JOURS_PERIODE_PAR_DEFAUT = 30;
// Au-delà de 3 mois de période, l'évolution passe de la semaine au mois.
const MOIS_AVANT_GRANULARITE_MENSUELLE = 3;

class ErreurFiltresTableauDeBord extends Error {}

// Jour calendaire 'AAAA-MM-JJ' de `instant` à Paris — jamais le jour UTC (entre minuit et 2 h, le
// jour UTC est encore la veille). Même technique que frontend dateDuJourParis.js.
function jourParis(instant) {
  const parties = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const valeur = (type) => parties.find((partie) => partie.type === type).value;
  return `${valeur('year')}-${valeur('month')}-${valeur('day')}`;
}

// Arithmétique sur des jours calendaires (sans heure ni fuseau) : passage par midi UTC pour ne
// jamais être décalé d'un jour par un changement d'heure.
function decalerJour(jour, nombreJours) {
  const date = new Date(`${jour}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + nombreJours);
  return date.toISOString().slice(0, 10);
}

function decalerMois(jour, nombreMois) {
  const date = new Date(`${jour}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + nombreMois);
  return date.toISOString().slice(0, 10);
}

// Semaine, ou mois si la période dépasse 3 mois (début antérieur à « fin moins 3 mois »).
function granularitePeriode(debut, fin) {
  return debut < decalerMois(fin, -MOIS_AVANT_GRANULARITE_MENSUELLE) ? 'mois' : 'semaine';
}

// Filtres déjà validés en forme par la route (dpae.routes.js) — ici : période par défaut (30
// derniers jours, heure de Paris) et cohérence début <= fin.
// statutsExclus : statuts invisibles pour le rôle de l'appelant, jamais saisis par le client (voir
// demandeDpaeService.statutsMasquesPour) ; absent de la réponse tant qu'il est vide.
function resoudreFiltres({ debut, fin, siteId, typeContrat, statut } = {}, maintenant = new Date(), statutsExclus = []) {
  const finResolue = fin ?? jourParis(maintenant);
  const debutResolu = debut ?? decalerJour(finResolue, -(JOURS_PERIODE_PAR_DEFAUT - 1));
  if (debutResolu > finResolue) {
    throw new ErreurFiltresTableauDeBord('La date de début de la période doit précéder sa date de fin.');
  }
  return {
    debut: debutResolu,
    fin: finResolue,
    siteId: siteId ?? null,
    typeContrat: typeContrat ?? null,
    statut: statut ?? null,
    ...(statutsExclus.length > 0 ? { statutsExclus: [...statutsExclus] } : {}),
  };
}

const enMap = (lignes) => Object.fromEntries(lignes.map((ligne) => [ligne.cle ?? 'non_renseigne', ligne.nombre]));
// Même clés que enMap, valeurs = identifiants des demandes comptées (même ligne SQL que le nombre).
const enMapIds = (lignes) => Object.fromEntries(lignes.map((ligne) => [ligne.cle ?? 'non_renseigne', ligne.ids ?? []]));

// Sites liés, [{ id, nom, initiales }], ajoutés à chaque ligne des listes cliquables ; [] pour une
// ancienne demande sans site lié (qui garde son texte `hotel`, non renvoyé ici : « Non référencé »).
function ajouterSitesAuxLignes(lignes, liens) {
  return lignes.map((ligne) => ({
    ...ligne,
    sites_affectation: liens.filter((lien) => lien.demande_dpae_id === ligne.id).map(({ id, nom, initiales }) => ({ id, nom, initiales })),
  }));
}

// Assemblage de la réponse à partir des résultats bruts des agrégats SQL — fonction pure (testée
// sans base, voir tableauDeBordDpaeService.test.js). Taux de rejet : rejetées / demandes DÉCIDÉES
// (validées + rejetées), null s'il n'y a encore aucune décision (jamais un 0 % trompeur).
function construireTableauDeBord({ filtres, granularite, optionsSites, bruts, liens }) {
  // en_attente (« En attente », 2026-09-30) : compté dans le total, jamais dans les décidées.
  const parStatut = {
    ...Object.fromEntries(CODES_STATUTS_DPAE.map((code) => [code, 0])),
    ...enMap(bruts.parStatut.map(({ statut, nombre }) => ({ cle: statut, nombre }))),
  };
  const total = CODES_STATUTS_DPAE.reduce((somme, code) => somme + parStatut[code], 0);
  const decidees = parStatut[STATUT_VALIDEE] + parStatut[STATUT_REJETEE];
  const dejaEmploye = enMap(bruts.dejaEmploye.map(({ cle, nombre }) => ({ cle: String(cle), nombre })));
  const idsDejaEmploye = enMapIds(bruts.dejaEmploye.map(({ cle, ids }) => ({ cle: String(cle), ids })));
  const idsParStatut = {
    ...Object.fromEntries(CODES_STATUTS_DPAE.map((code) => [code, []])),
    ...enMapIds(bruts.parStatut.map(({ statut, ids }) => ({ cle: statut, ids }))),
  };
  const finsDeCdd = ajouterSitesAuxLignes(bruts.finsDeCdd, liens);
  // « À traiter en priorité » : UNIQUEMENT des demandes sur lesquelles la RH doit
  // encore agir (À traiter ou En attente, voir le repository). Une demande présente dans les deux
  // listes n'est comptée qu'une fois.
  const premierJourProche = ajouterSitesAuxLignes(bruts.premierJourProche, liens);
  const aTraiterPlus24h = ajouterSitesAuxLignes(bruts.aTraiterPlus24h, liens);
  const nombrePriorites = new Set([...premierJourProche, ...aTraiterPlus24h].map((ligne) => ligne.id)).size;
  const valideesEnRetard = ajouterSitesAuxLignes(bruts.valideesEnRetard, liens);

  return {
    filtres,
    granularite,
    optionsSites,
    priorite: {
      nombre: nombrePriorites,
      premierJourProche,
      aTraiterPlus24h,
    },
    // Champs `ids*` (2026-10-02) : identifiants des demandes comptées par chaque indicateur, calculés
    // dans la même requête que le nombre (tableauDeBordDpaeRepository.js) — liste des demandes au
    // clic sur un indicateur. Indicateurs sans liste (taux, délais) : aucun identifiant.
    activite: {
      total,
      ids: CODES_STATUTS_DPAE.flatMap((code) => idsParStatut[code]),
      parStatut,
      idsParStatut,
      tauxRejet: decidees > 0 ? parStatut[STATUT_REJETEE] / decidees : null,
      nombreTraitees: bruts.delais.nombre_traitees,
      delaiMoyenHeures: bruts.delais.moyen_heures,
      delaiMedianHeures: bruts.delais.median_heures,
      evolution: bruts.evolution,
    },
    // Déclarations tardives : validées après leur premier jour, sur la période filtrée.
    // part = tardives / validées de la même sélection ; null s'il n'y a aucune validée (jamais un
    // 0 % trompeur, même règle que le taux de rejet).
    declarationsTardives: {
      nombre: valideesEnRetard.length,
      nombreValidees: parStatut[STATUT_VALIDEE],
      part: parStatut[STATUT_VALIDEE] > 0 ? valideesEnRetard.length / parStatut[STATUT_VALIDEE] : null,
      demandes: valideesEnRetard,
    },
    repartition: {
      contrats: { cdd: 0, cdi: 0, ...enMap(bruts.contrats) },
      idsContrats: { cdd: [], cdi: [], ...enMapIds(bruts.contrats) },
      motifsCdd: { remplacement_absent: 0, surcroit_activite: 0, ...enMap(bruts.motifsCdd) },
      idsMotifsCdd: { remplacement_absent: [], surcroit_activite: [], ...enMapIds(bruts.motifsCdd) },
      sites: bruts.topSites,
      nonReferencees: bruts.nonReferencees.nombre,
      idsNonReferencees: bruts.nonReferencees.ids ?? [],
      postes: bruts.postes.map(({ cle, nombre, ids }) => ({ poste: cle, nombre, ids: ids ?? [] })),
      demandeurs: bruts.demandeurs,
      nouveauxSalaries: dejaEmploye.false ?? 0,
      idsNouveauxSalaries: idsDejaEmploye.false ?? [],
      dejaTravailleChezNous: dejaEmploye.true ?? 0,
      idsDejaTravailleChezNous: idsDejaEmploye.true ?? [],
    },
    anticipation: {
      sous7Jours: finsDeCdd.filter((ligne) => ligne.sous_7_jours).length,
      sous15Jours: finsDeCdd.length,
      demandes: finsDeCdd,
    },
  };
}

// Point d'entrée de la route. `maintenant` injectable (tests / script d'intégration).
async function calculerTableauDeBord(entite, filtresDemandes = {}, maintenant = new Date(), bd = null, { statutsExclus = [] } = {}) {
  const connexion = bd ?? (await db.obtenirKnex());
  const filtres = resoudreFiltres(filtresDemandes, maintenant, statutsExclus);
  const granularite = granularitePeriode(filtres.debut, filtres.fin);
  const r = tableauDeBordDpaeRepository;
  const e = entite.id;
  // Requêtes en parallèle sur le pool (cas normal de la route) ; en séquence dans une transaction
  // (script d'intégration), qui n'a qu'une connexion : le pilote pg déconseille d'y empiler des
  // requêtes simultanées.
  const executer = (fonctions) =>
    connexion.isTransaction
      ? fonctions.reduce(async (precedent, fonction) => [...(await precedent), await fonction()], Promise.resolve([]))
      : Promise.all(fonctions.map((fonction) => fonction()));

  const [
    premierJourProche,
    aTraiterPlus24h,
    valideesEnRetard,
    parStatut,
    delais,
    evolution,
    contrats,
    motifsCdd,
    topSites,
    nonReferencees,
    postes,
    demandeurs,
    dejaEmploye,
    finsDeCdd,
    optionsSites,
  ] = await executer([
    () => r.listerPremierJourProche(connexion, e, filtres, maintenant),
    () => r.listerATraiterPlus24h(connexion, e, filtres, maintenant),
    () => r.listerValideesEnRetard(connexion, e, filtres),
    () => r.compterParStatut(connexion, e, filtres),
    () => r.calculerDelais(connexion, e, filtres),
    () => r.calculerEvolution(connexion, e, filtres, granularite),
    () => r.repartirParContrat(connexion, e, filtres),
    () => r.repartirMotifsCdd(connexion, e, filtres),
    () => r.listerTopSites(connexion, e, filtres),
    () => r.compterNonReferencees(connexion, e, filtres),
    () => r.repartirParPoste(connexion, e, filtres),
    () => r.repartirParDemandeur(connexion, e, filtres),
    () => r.repartirDejaEmploye(connexion, e, filtres),
    () => r.listerFinsDeCdd(connexion, e, filtres, maintenant),
    () => siteAffectationRepository.listerSitesActifs(connexion, e),
  ]);

  const idsListes = [...new Set([...premierJourProche, ...aTraiterPlus24h, ...valideesEnRetard, ...finsDeCdd].map((ligne) => ligne.id))];
  const liens = await siteAffectationRepository.listerSitesParDemandes(connexion, idsListes);

  return construireTableauDeBord({
    filtres,
    granularite,
    optionsSites,
    liens,
    bruts: {
      premierJourProche,
      aTraiterPlus24h,
      valideesEnRetard,
      parStatut,
      delais,
      evolution,
      contrats,
      motifsCdd,
      topSites,
      nonReferencees,
      postes,
      demandeurs,
      dejaEmploye,
      finsDeCdd,
    },
  });
}

module.exports = {
  ErreurFiltresTableauDeBord,
  jourParis,
  decalerJour,
  granularitePeriode,
  resoudreFiltres,
  construireTableauDeBord,
  calculerTableauDeBord,
};
