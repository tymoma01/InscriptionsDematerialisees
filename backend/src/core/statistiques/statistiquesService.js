// Orchestration du tableau de bord KPI back-office — une seule fonction publique, qui compose en
// parallèle les 7 statistiques (CLAUDE.md, besoin Coordination/RH : "tableau de bord... alimenté
// par les statuts et motifs"), toutes filtrées par la même période/poste/typePoste. Requêtes
// agrégées à la volée (pas de vue matérialisée) : volume actuel de l'ordre de ~3000 dossiers/an
// (voir CLAUDE.md, signatures de charte), largement dans les capacités de Postgres avec les index
// ciblés posés par la migration 042.

const { obtenirKnex } = require('../../db/knex');
const statistiquesRepository = require('./statistiquesRepository');
const dossierRepository = require('../dossier/dossierRepository');
const { POSTES_BUREAU, POSTES_HOTEL } = require('../dossier/postesConstantes');

// Erreur métier distincte d'une Error générique (500 opaque) — même principe que
// ErreurPieceJustificativeInvalide (pieceJustificativeService.js) : statistiques.routes.js la
// traduit en 400 avec un message directement affichable au recruteur, plutôt que de laisser un
// code d'indicateur inconnu tomber dans le gestionnaire d'erreurs générique.
class ErreurStatistiquesInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurStatistiquesInvalide';
  }
}

// dateFin est une borne incluse côté utilisateur (jour calendaire) — convertie ici en borne
// exclusive du lendemain, même convention que rendezvousTestQuerySchema (dossiers.routes.js) :
// simplifie chaque requête du repository à une seule paire >= / < plutôt que whereBetween (qui
// inclurait toute la journée de dateFin sauf la dernière milliseconde, piège classique sur une
// colonne timestamptz).
function bornesPeriode(dateDebut, dateFin) {
  const debut = new Date(`${dateDebut}T00:00:00.000Z`);
  const finExclusive = new Date(`${dateFin}T00:00:00.000Z`);
  finExclusive.setUTCDate(finExclusive.getUTCDate() + 1);
  return { debut, finExclusive };
}

// node-postgres renvoie les agrégats bigint/numeric sous forme de chaîne (jamais un number natif,
// pour ne pas perdre de précision au-delà de Number.MAX_SAFE_INTEGER) — reconverti ici une seule
// fois plutôt qu'à chaque site d'appel.
function versNombre(valeur) {
  return valeur === null || valeur === undefined ? 0 : Number(valeur);
}

function versMoyenneJours(valeur) {
  if (valeur === null || valeur === undefined) return null;
  return Math.round(Number(valeur) * 10) / 10;
}

async function obtenirIndicateursKpi(entite, { dateDebut, dateFin, typePoste, poste }) {
  const bd = await obtenirKnex();
  const filtres = { ...bornesPeriode(dateDebut, dateFin), typePoste, poste };

  const [
    inscrits,
    envoyesEnTest,
    verdicts,
    orientations,
    dossiersConvertis,
    repartitionParEvaluation,
    repartitionParOccurrence,
    evaluationsSansPoste,
    delaiInscriptionTest,
    delaiTestVerdict,
  ] = await Promise.all([
    statistiquesRepository.compterInscrits(bd, entite.id, filtres),
    statistiquesRepository.compterEnvoyesEnTest(bd, entite.id, filtres),
    statistiquesRepository.compterVerdicts(bd, entite.id, filtres),
    statistiquesRepository.compterOrientations(bd, entite.id, filtres),
    statistiquesRepository.compterDossiersConvertis(bd, entite.id, filtres),
    statistiquesRepository.listerRepartitionParEvaluation(bd, entite.id, filtres),
    statistiquesRepository.listerRepartitionParOccurrence(bd, entite.id, filtres),
    statistiquesRepository.compterEvaluationsSansPoste(bd, entite.id, filtres),
    statistiquesRepository.delaiInscriptionVersTestPlanifie(bd, entite.id, filtres),
    statistiquesRepository.delaiTestVersVerdict(bd, entite.id, filtres),
  ]);

  const totalInscrits = versNombre(inscrits.total);
  const totalConvertis = versNombre(dossiersConvertis.total);

  const verdictsParResultat = { valide: 0, invalide: 0 };
  for (const ligne of verdicts) {
    verdictsParResultat[ligne.resultat_global] = versNombre(ligne.total);
  }

  const orientationsParCode = { envoi_formation: 0, pret_embauche: 0 };
  for (const ligne of orientations) {
    if (ligne.orientation) orientationsParCode[ligne.orientation] = versNombre(ligne.total);
  }

  const parEvaluation = repartitionParEvaluation.map((ligne) => ({
    posteCode: ligne.poste_code,
    nbEvaluations: versNombre(ligne.nb_evaluations),
  }));
  const nbEvaluationsSansPoste = versNombre(evaluationsSansPoste.total);
  if (nbEvaluationsSansPoste > 0) {
    // Ajoutée explicitement plutôt qu'exclue silencieusement (décision validée) — posteCode null
    // distingue cette catégorie d'un vrai code de poste, le libellé "Non spécifié" reste une
    // responsabilité d'affichage côté front (voir Indicateurs.jsx).
    parEvaluation.push({ posteCode: null, nbEvaluations: nbEvaluationsSansPoste });
  }

  return {
    periode: { dateDebut, dateFin },
    filtres: { typePoste: typePoste ?? null, poste: poste ?? null },
    inscrits: { total: totalInscrits },
    envoyesEnTest: { total: versNombre(envoyesEnTest.total) },
    verdicts: verdictsParResultat,
    orientations: orientationsParCode,
    conversion: {
      numerateur: totalConvertis,
      denominateur: totalInscrits,
      // null plutôt qu'une division par zéro si aucun inscrit sur la période (période vide ou
      // filtre poste trop restrictif) — un taux à 0 laisserait croire à 0% de conversion plutôt
      // qu'à "rien à mesurer".
      taux: totalInscrits > 0 ? totalConvertis / totalInscrits : null,
    },
    repartitionParPoste: {
      parEvaluation,
      parOccurrence: repartitionParOccurrence.map((ligne) => ({
        posteCode: ligne.poste_code,
        nbOccurrences: versNombre(ligne.nb_occurrences),
      })),
    },
    delaisMoyens: {
      inscriptionVersTestPlanifie: {
        moyenneJours: versMoyenneJours(delaiInscriptionTest.moyenne_jours),
        nbDossiers: versNombre(delaiInscriptionTest.nb_dossiers),
      },
      testVersVerdict: {
        moyenneJours: versMoyenneJours(delaiTestVerdict.moyenne_jours),
        nbDossiers: versNombre(delaiTestVerdict.nb_dossiers),
      },
    },
  };
}

// Codes d'indicateurs statiques exposés par le dashboard (cartes + segments de camemberts) —
// PAS les libellés : ils restent une responsabilité d'affichage du front (Indicateurs.jsx connaît
// déjà "Inscrits"/"Envoyés en test"/... pour les cartes, pas de raison de les dupliquer ici).
// Les segments du graphique de répartition par poste ne sont pas dans cette liste : leur code est
// dynamique, 'poste:<code>' (voir résoudreListeIndicateur ci-dessous), un par poste réellement
// configuré pour l'entité (POSTES_BUREAU/POSTES_HOTEL) plutôt qu'une énumération figée ici.
const CODES_INDICATEURS_STATIQUES = [
  'inscrits',
  'envoyes_en_test',
  'verdict_valide',
  'verdict_invalide',
  'orientation_envoi_formation',
  'orientation_pret_embauche',
  'conversion',
  'delai_inscription_test',
  'delai_test_verdict',
];

const PREFIXE_POSTE = 'poste:';

// Une seule fonction de résolution code -> requête "liste de dossiers", pour que
// listerDossiersParIndicateurs ci-dessous n'ait qu'à itérer sur les codes demandés sans connaître
// le détail de chaque indicateur — même principe de composition que obtenirIndicateursKpi
// ci-dessus, mais pour la variante "liste" plutôt que "compte".
function resoudreListeIndicateur(bd, entiteId, filtres, code) {
  switch (code) {
    case 'inscrits':
      return statistiquesRepository.listerInscrits(bd, entiteId, filtres);
    case 'envoyes_en_test':
      return statistiquesRepository.listerEnvoyesEnTest(bd, entiteId, filtres);
    case 'verdict_valide':
      return statistiquesRepository.listerVerdicts(bd, entiteId, filtres, 'valide');
    case 'verdict_invalide':
      return statistiquesRepository.listerVerdicts(bd, entiteId, filtres, 'invalide');
    case 'orientation_envoi_formation':
      return statistiquesRepository.listerOrientations(bd, entiteId, filtres, 'envoi_formation');
    case 'orientation_pret_embauche':
      return statistiquesRepository.listerOrientations(bd, entiteId, filtres, 'pret_embauche');
    case 'conversion':
      return statistiquesRepository.listerDossiersConvertis(bd, entiteId, filtres);
    case 'delai_inscription_test':
      return statistiquesRepository.listerDelaiInscriptionVersTestPlanifie(bd, entiteId, filtres);
    case 'delai_test_verdict':
      return statistiquesRepository.listerDelaiTestVersVerdict(bd, entiteId, filtres);
    default:
      if (code.startsWith(PREFIXE_POSTE)) {
        const posteCode = code.slice(PREFIXE_POSTE.length);
        if (![...POSTES_BUREAU, ...POSTES_HOTEL].includes(posteCode)) {
          throw new ErreurStatistiquesInvalide(`Code de poste "${posteCode}" inconnu.`);
        }
        return statistiquesRepository.listerRepartitionParPosteDossiers(bd, entiteId, filtres, posteCode);
      }
      throw new ErreurStatistiquesInvalide(
        `Indicateur "${code}" inconnu (attendu : ${CODES_INDICATEURS_STATIQUES.join(', ')}, ou "${PREFIXE_POSTE}<code>").`,
      );
  }
}

// Tableau consolidé du dashboard KPI (cartes/segments cliquables, voir Indicateurs.jsx) : pour
// une sélection d'indicateurs, renvoie les dossiers qui en satisfont AU MOINS UN, dédupliqués (un
// dossier sélectionné par deux indicateurs à la fois n'apparaît qu'une fois), chacun annoté de la
// liste des indicateurs demandés qu'il satisfait effectivement (pour les badges + la colonne
// "dates clés" du tableau). Même bornesPeriode()/filtres que obtenirIndicateursKpi : les deux
// endpoints doivent toujours s'accorder sur ce qui compte comme "dans la période".
async function listerDossiersParIndicateurs(entite, { dateDebut, dateFin, typePoste, poste, indicateurs }) {
  const bd = await obtenirKnex();
  const filtres = { ...bornesPeriode(dateDebut, dateFin), typePoste, poste };

  const resultatsParIndicateur = await Promise.all(
    indicateurs.map(async (code) => ({ code, lignes: await resoudreListeIndicateur(bd, entite.id, filtres, code) })),
  );

  // dossierId -> code indicateur -> date_cle (Map imbriquée plutôt qu'un tableau à plat : accès
  // direct par dossier au moment de fusionner avec les infos d'affichage ci-dessous, sans
  // reparcourir résultatsParIndicateur à chaque dossier).
  const indicateursParDossier = new Map();
  for (const { code, lignes } of resultatsParIndicateur) {
    for (const ligne of lignes) {
      const dossierId = ligne.dossier_id;
      if (!indicateursParDossier.has(dossierId)) indicateursParDossier.set(dossierId, new Map());
      indicateursParDossier.get(dossierId).set(code, ligne.date_cle);
    }
  }

  const dossierIds = [...indicateursParDossier.keys()];
  const dossiers = await dossierRepository.listerDossiersParIds(bd, entite.id, dossierIds);

  return dossiers
    .map(({ donnees_disponibilites, ...reste }) => ({
      ...reste,
      postesBureau: donnees_disponibilites?.posteBureau ?? [],
      postesHotel: donnees_disponibilites?.posteHotel ?? [],
      // Respecte l'ordre de `indicateurs` demandé par l'appelant (pas l'ordre d'insertion dans la
      // Map, qui dépendrait de Promise.all) — affichage des badges stable d'un appel à l'autre.
      indicateurs: indicateurs
        .filter((code) => indicateursParDossier.get(reste.id).has(code))
        .map((code) => ({ code, dateCle: indicateursParDossier.get(reste.id).get(code) })),
    }))
    .sort((a, b) => new Date(b.date_maj) - new Date(a.date_maj));
}

module.exports = {
  obtenirIndicateursKpi,
  listerDossiersParIndicateurs,
  ErreurStatistiquesInvalide,
  CODES_INDICATEURS_STATIQUES,
};
