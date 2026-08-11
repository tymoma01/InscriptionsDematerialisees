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

// Un poste précis implique déjà son typePoste (voir statistiquesRepository.filtrerPosteDossier,
// commentaire "poste prime sur typePoste s'ils sont fournis tous les deux") : quand les deux sont
// fournis ET incohérents (ex. poste="nettoyage", un poste Tertiaire, avec typePoste="hotel"), le
// repository ignore typePoste silencieusement plutôt que de lever une erreur — un filtre "Entité"
// silencieusement ignoré donnerait des résultats trompeurs (tous les dossiers "nettoyage", pas
// seulement ceux d'Hôtellerie) sans que rien ne le signale à l'agent. Validé une seule fois ici,
// avant toute requête au repository, plutôt que dupliqué dans chaque fonction de
// statistiquesRepository.js — même principe que la validation des codes d'indicateurs plus bas
// (résoudreListeIndicateur), qui lève déjà ErreurStatistiquesInvalide pour la même raison.
function validerCoherencePosteTypePoste({ typePoste, poste }) {
  if (!typePoste || !poste) return;
  const postesAttendus = typePoste === 'bureau' ? POSTES_BUREAU : POSTES_HOTEL;
  if (!postesAttendus.includes(poste)) {
    throw new ErreurStatistiquesInvalide(
      `Le poste "${poste}" n'appartient pas au type de poste "${typePoste}" filtré.`,
    );
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
  validerCoherencePosteTypePoste({ typePoste, poste });
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
// déjà "Inscrits"/"Envoyé en test"/... pour les cartes, pas de raison de les dupliquer ici).
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
  // Barre "Non spécifié" du graphique de répartition par poste (Indicateurs.jsx) — statique
  // (contrairement aux barres 'poste:<code>' ci-dessous) : "aucun poste renseigné" n'est pas un
  // poste parmi POSTES_BUREAU/POSTES_HOTEL, ne peut donc pas prendre le préfixe 'poste:'.
  'poste_non_specifie',
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
    case 'poste_non_specifie':
      return statistiquesRepository.listerEvaluationsSansPosteDossiers(bd, entiteId, filtres);
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

// Tableau consolidé du dashboard KPI (cartes/segments cliquables, voir Indicateurs.jsx) — ET
// STRICT : intersection de TOUS les indicateurs sélectionnés, peu importe leur nature (décision
// utilisateur, 2026-08-07 — remplace un filtrage à facettes catégorisé essayé juste avant, voir
// historique git, jugé trop implicite : "Inscrits" + "Test réussi" + "Envoi en formation" ne
// montre désormais que les dossiers qui satisfont les TROIS à la fois). Conséquence acceptée :
// deux indicateurs mutuellement exclusifs (ex. verdict_valide + verdict_invalide, un dossier n'a
// qu'un seul verdict par test) donnent un résultat vide — comportement normal d'un ET strict, pas
// un cas particulier à détecter ni à traiter différemment.
async function listerDossiersParIndicateurs(entite, { dateDebut, dateFin, typePoste, poste, indicateurs }) {
  validerCoherencePosteTypePoste({ typePoste, poste });
  const bd = await obtenirKnex();
  const filtres = { ...bornesPeriode(dateDebut, dateFin), typePoste, poste };

  const resultatsParIndicateur = await Promise.all(
    indicateurs.map(async (code) => ({ code, lignes: await resoudreListeIndicateur(bd, entite.id, filtres, code) })),
  );

  // dossierId -> code indicateur -> date_cle (pour les badges/dates du tableau, voir plus bas) —
  // construite en même temps que la liste des ids par indicateur ci-dessous, qui sert elle à
  // l'intersection.
  const indicateursParDossier = new Map();
  const idsParIndicateur = resultatsParIndicateur.map(({ code, lignes }) => {
    const ids = new Set();
    for (const ligne of lignes) {
      const dossierId = ligne.dossier_id;
      if (!indicateursParDossier.has(dossierId)) indicateursParDossier.set(dossierId, new Map());
      indicateursParDossier.get(dossierId).set(code, ligne.date_cle);
      ids.add(dossierId);
    }
    return ids;
  });

  // Intersection de TOUS les ensembles, y compris ceux vides : un indicateur sans aucun dossier
  // correspondant vide déjà le résultat final à ce stade, sans traitement particulier (comportement
  // naturel de l'intersection, pas un cas à détecter séparément comme avec le filtrage à facettes).
  let dossierIdsRetenus = null; // null = aucune contrainte posée pour l'instant (aucun indicateur encore traité)
  for (const ids of idsParIndicateur) {
    dossierIdsRetenus = dossierIdsRetenus === null ? ids : new Set([...dossierIdsRetenus].filter((id) => ids.has(id)));
  }
  const dossierIds = dossierIdsRetenus ? [...dossierIdsRetenus] : [];

  const dossiers = await dossierRepository.listerDossiersParIds(bd, entite.id, dossierIds);

  return dossiers
    .map(
      ({
        donnees_disponibilites,
        date_test_planifie,
        date_verdict,
        verdict_resultat_global,
        verdict_orientation,
        date_derniere_planification_avant_verdict,
        ...reste
      }) => ({
        ...reste,
        postesBureau: donnees_disponibilites?.posteBureau ?? [],
        postesHotel: donnees_disponibilites?.posteHotel ?? [],
        // Colonne "Dates clés" du tableau consolidé (TableauDossiersSelectionnes.jsx) : la ligne
        // "verdict_valide"/"verdict_invalide" avait été retirée le 2026-08-11 (jugée redondante
        // avec la colonne "Statut", affichée alors INCONDITIONNELLEMENT) — puis "Dates clés" est
        // devenue, le 2026-08-12, strictement calée sur la sélection des tuiles/segments (comme la
        // colonne "Indicateurs" : voir construireColonnesAlignees, TableauDossiersSelectionnes.jsx)
        // : la redondance ne se pose plus de la même façon, une ligne "Verdict" n'apparaît
        // désormais QUE si l'utilisateur a explicitement sélectionné "Test réussi"/"Test raté" (clic
        // sur le camembert "Tests réussis vs ratés", même mécanisme `basculerIndicateur` que les
        // tuiles) — remise en place le 2026-08-12 pour ce cas précis. `reste.date_creation` existe
        // toujours (colonne NOT NULL) ; test_planifie/verdict/orientation sont NULL tant que le
        // dossier n'a pas atteint cette étape — filtrées ici plutôt que laissées à `null` pour que
        // le front n'ait qu'à itérer, sans condition (pas de date vide/placeholder). Codes
        // 'verdict_valide'/'verdict_invalide'/'orientation_envoi_formation'/'orientation_
        // pret_embauche' repris tels quels de CODES_INDICATEURS_STATIQUES ci-dessus (même
        // événement, une évaluation) — permet au front de réutiliser directement varianteIndicateur
        // pour la couleur de cette colonne, sans palette dupliquée (voir Indicateurs.jsx,
        // varianteDateCle), et à construireColonnesAlignees de reconnaître directement la
        // correspondance badge↔date (même code des deux côtés, pas d'entrée supplémentaire
        // nécessaire dans CODE_BADGE_PAR_CODE_DATE).
        datesCles: [
          { code: 'inscription', date: reste.date_creation },
          date_test_planifie ? { code: 'test_planifie', date: date_test_planifie } : null,
          date_verdict
            ? { code: verdict_resultat_global === 'invalide' ? 'verdict_invalide' : 'verdict_valide', date: date_verdict }
            : null,
          date_verdict && verdict_orientation ? { code: `orientation_${verdict_orientation}`, date: date_verdict } : null,
        ].filter(Boolean),
        // Ancre de FIN du délai "test → verdict" (colonne "Dates clés", construireColonnesAlignees)
        // — la ligne "Verdict" elle-même n'existant plus dans `datesCles` ci-dessus, ce champ dédié
        // reste le seul moyen pour le front de connaître la date exacte du verdict (nécessaire au
        // calcul du délai, indépendamment de son affichage). NULL tant qu'aucune évaluation.
        dateVerdict: date_verdict ?? null,
        // Ancre de DÉPART du délai "test → verdict" — DISTINCTE de `date_test_planifie` ci-dessus
        // (première planification, correcte pour la ligne "Test planifié"/le délai "inscription →
        // test") : correctif audit 2026-08-11, voir dossierRepository.listerDossiersParIds. Champ
        // dédié plutôt qu'une entrée dans `datesCles` : ce n'est pas une ligne à afficher telle
        // quelle, seulement une donnée d'entrée du calcul de délai.
        dateDernierTestPlanifieAvantVerdict: date_derniere_planification_avant_verdict ?? null,
        // Respecte l'ordre de `indicateurs` demandé par l'appelant (pas l'ordre d'insertion dans la
        // Map, qui dépendrait de Promise.all) — affichage des badges stable d'un appel à l'autre.
        // Avec un ET strict, un dossier retenu satisfait de toute façon TOUS les codes demandés :
        // ce filtre n'est donc plus qu'une garde de cohérence (utile si jamais indicateursParDossier
        // et l'intersection divergeaient), pas un tri actif comme du temps du filtrage à facettes.
        indicateurs: indicateurs
          .filter((code) => indicateursParDossier.get(reste.id)?.has(code))
          .map((code) => ({ code, dateCle: indicateursParDossier.get(reste.id).get(code) })),
      }),
    )
    .sort((a, b) => new Date(b.date_maj) - new Date(a.date_maj));
}

module.exports = {
  obtenirIndicateursKpi,
  listerDossiersParIndicateurs,
  ErreurStatistiquesInvalide,
  CODES_INDICATEURS_STATIQUES,
};
