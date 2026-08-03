// Orchestration du tableau de bord KPI back-office — une seule fonction publique, qui compose en
// parallèle les 7 statistiques (CLAUDE.md, besoin Coordination/RH : "tableau de bord... alimenté
// par les statuts et motifs"), toutes filtrées par la même période/poste/typePoste. Requêtes
// agrégées à la volée (pas de vue matérialisée) : volume actuel de l'ordre de ~3000 dossiers/an
// (voir CLAUDE.md, signatures de charte), largement dans les capacités de Postgres avec les index
// ciblés posés par la migration 042.

const { obtenirKnex } = require('../../db/knex');
const statistiquesRepository = require('./statistiquesRepository');

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

module.exports = { obtenirIndicateursKpi };
