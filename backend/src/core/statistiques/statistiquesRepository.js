// Accès données pour le tableau de bord KPI back-office (CLAUDE.md, besoin Coordination/RH :
// "tableau de bord... indicateurs de pilotage") — uniquement des requêtes, aucune règle métier
// ici (orchestrée par statistiquesService.js), même découpage que dossierRepository.js.
//
// Toutes les fonctions ci-dessous reçoivent { debut, finExclusive } (bornes de période déjà
// résolues côté service, finExclusive = lendemain de la date de fin demandée) et { typePoste,
// poste } (filtres optionnels) en plus de bd/entiteId.

const { POSTES_BUREAU, POSTES_HOTEL } = require('../dossier/postesConstantes');

function codesPostesPourTypePoste(typePoste) {
  if (typePoste === 'bureau') return POSTES_BUREAU;
  if (typePoste === 'hotel') return POSTES_HOTEL;
  return null;
}

// Rattache le bloc 'disponibilites' du formulaire d'inscription (JSONB, posteBureau/posteHotel/
// typePoste — voir dossier_donnees_formulaire, migration 013) à une requête déjà scopée
// `dossiers` — sert au filtre poste/typePoste des statistiques au niveau dossier (inscrits,
// envoyés en test, conversion). C'est la seule mécanique disponible pour ce filtre à ce niveau :
// il n'existe pas de colonne typePoste sur `dossiers`, et "entité" Hôtellerie/Tertiaire n'est pas
// une ligne de la table `entites` (voir Modularité, CLAUDE.md — audit KPI Dashboard).
function joindreDisponibilitesDossier(requete, bd) {
  return requete.leftJoin('dossier_donnees_formulaire as bloc_disponibilites', function () {
    this.on('bloc_disponibilites.dossier_id', '=', 'dossiers.id').andOn(
      'bloc_disponibilites.bloc_code',
      '=',
      bd.raw('?', ['disponibilites']),
    );
  });
}

// À appeler après joindreDisponibilitesDossier ci-dessus. `poste` prime sur `typePoste` s'ils
// sont fournis tous les deux (un poste précis implique déjà son typePoste, pas la peine de tester
// les deux) — un dossier peut déclarer plusieurs postes dans le même tableau JSONB, d'où le test
// de containment (@>) plutôt qu'une égalité stricte.
function filtrerPosteDossier(requete, { typePoste, poste } = {}) {
  if (poste) {
    requete.andWhere((constructeur) => {
      constructeur
        .whereRaw("bloc_disponibilites.donnees -> 'posteBureau' @> ?::jsonb", [JSON.stringify([poste])])
        .orWhereRaw("bloc_disponibilites.donnees -> 'posteHotel' @> ?::jsonb", [JSON.stringify([poste])]);
    });
  } else if (typePoste) {
    // .andWhere(expr, valeur) traite `expr` comme un identifiant de colonne (knex la quote telle
    // quelle) plutôt que comme du SQL — whereRaw ici, même pattern que la branche `poste`
    // ci-dessus, pour que l'opérateur ->> soit bien interprété comme du SQL et non comme un nom de
    // colonne littéral (voir bug /tableau-de-bord/indicateurs, filtre Entité, 2026-08-10 : erreur
    // 42703 "column bloc_disponibilites.donnees ->> 'typePoste' does not exist").
    requete.whereRaw("bloc_disponibilites.donnees ->> 'typePoste' = ?", [typePoste]);
  }
  return requete;
}

// Semi-join vers evaluations_postes pour les statistiques au niveau évaluation (verdicts,
// orientations) — whereIn plutôt qu'un JOIN direct : une évaluation avec plusieurs postes
// correspondant au filtre ne doit pas être comptée plusieurs fois. Pas de colonne typePoste sur
// evaluations_postes : déduite en filtrant poste_code par appartenance à POSTES_BUREAU/
// POSTES_HOTEL (constantes JS partagées, voir postesConstantes.js), jamais par jointure sur
// `entites` (voir Modularité, CLAUDE.md).
function filtrerPostesEvaluationParSemiJoin(requete, bd, { typePoste, poste } = {}) {
  if (poste) {
    requete.whereIn('evaluations.id', bd('evaluations_postes').select('evaluation_id').where('poste_code', poste));
  } else if (typePoste) {
    requete.whereIn(
      'evaluations.id',
      bd('evaluations_postes').select('evaluation_id').whereIn('poste_code', codesPostesPourTypePoste(typePoste)),
    );
  }
  return requete;
}

// Stat 1 — nombre d'inscrits (dossiers créés) sur la période, pour l'entité courante.
function compterInscrits(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('dossiers')
    .where('dossiers.entite_id', entiteId)
    .andWhere('dossiers.date_creation', '>=', debut)
    .andWhere('dossiers.date_creation', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.count('dossiers.id as total').first();
}

// Stat 2 — nombre de dossiers distincts ayant eu le statut test_planifie sur la période, d'après
// historique_statuts (pas le statut courant de dossiers : un dossier reprogrammé ou déjà validé
// depuis reste compté s'il est bien passé par test_planifie pendant la période demandée).
function compterEnvoyesEnTest(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts')
    .join('dossiers', 'dossiers.id', 'historique_statuts.dossier_id')
    .join('statuts', 'statuts.id', 'historique_statuts.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', 'test_planifie')
    .andWhere('historique_statuts.date_changement', '>=', debut)
    .andWhere('historique_statuts.date_changement', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.countDistinct('historique_statuts.dossier_id as total').first();
}

// Stat 3 — verdicts (evaluations.resultat_global), groupés, sur la période.
function compterVerdicts(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive);
  filtrerPostesEvaluationParSemiJoin(requete, bd, { typePoste, poste });
  return requete.groupBy('evaluations.resultat_global').select('evaluations.resultat_global').count('evaluations.id as total');
}

// Orientation EFFECTIVE d'une évaluation valide — règle générale, pas un correctif ponctuel sur
// des dossiers précis (audit du 2026-08-12, dossiers #89/#74 : evaluations.orientation reste
// TOUJOURS NULL pour une évaluation soumise par le rôle Inspecteur, par conception, voir
// evaluationEngine.js.enregistrerEvaluation : "le bureau n'a pas de notion de formation, son seul
// verdict positif correspond exactement à ce que [le statut valide_pret_embauche] porte déjà" —
// ces dossiers passent directement à valide_pret_embauche sans jamais passer par un choix
// d'orientation explicite). COALESCE : la valeur enregistrée prime si elle existe (rôle Formateur,
// envoi_formation OU pret_embauche) ; sinon, un dossier dont le STATUT COURANT est
// valide_pret_embauche est déduit "pret_embauche" (rôle Inspecteur) — jamais "envoi_formation" par
// déduction, ce statut n'existant que pour la filière hôtel/Formateur, qui renseigne toujours
// orientation explicitement. S'applique automatiquement à tout dossier futur évalué par un
// Inspecteur, sans intervention manuelle — nécessite un JOIN vers `statuts` (voir compterOrientations/
// listerOrientations ci-dessous), absent des autres stats de ce fichier. Dupliqué (pas partagé) dans
// dossierRepository.listerDossiersParIds, même règle, pour la colonne "Dates clés"/le badge
// "Indicateurs" du tableau détaillé — même principe que les autres duplications back/back de ce
// projet (voir CLAUDE.md, conventions de code).
const ORIENTATION_EFFECTIVE_SQL = `
  COALESCE(
    evaluations.orientation,
    CASE WHEN statuts.code = 'valide_pret_embauche' THEN 'pret_embauche' END
  )
`;

// Stat 4 — orientation EFFECTIVE (voir ORIENTATION_EFFECTIVE_SQL ci-dessus), uniquement pour les
// verdicts positifs, groupée, sur la période.
function compterOrientations(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.resultat_global', 'valide')
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive);
  filtrerPostesEvaluationParSemiJoin(requete, bd, { typePoste, poste });
  return requete
    .groupByRaw(ORIENTATION_EFFECTIVE_SQL)
    .select(bd.raw(`${ORIENTATION_EFFECTIVE_SQL} as orientation`))
    .count('evaluations.id as total');
}

// Stat 5 (numérateur) — dossiers dont le statut COURANT est l'un des deux statuts finaux positifs
// (valide_pret_embauche / valide_envoi_formation), cohorte sur dossiers.date_creation (même
// période que le dénominateur compterInscrits ci-dessus) — c'est un taux de "validation" sur la
// cohorte d'inscrits de la période, pas d'embauche réelle confirmée (décision validée).
function compterDossiersConvertis(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .whereIn('statuts.code', ['valide_pret_embauche', 'valide_envoi_formation'])
    .andWhere('dossiers.date_creation', '>=', debut)
    .andWhere('dossiers.date_creation', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.count('dossiers.id as total').first();
}

// Stat 5bis — effectif de dossiers dont le STATUT COURANT (dossiers.statut_id) est `statutCode`,
// sur la MÊME cohorte que compterInscrits/compterDossiersConvertis ci-dessus (dossiers créés dans
// la période) — GÉNÉRIQUE (voir Modularité, CLAUDE.md) : une seule fonction pour n'importe quel
// code de statut de l'entité, symétrique du filtre poste 'poste:<code>' déjà en place
// (requeteBaseRepartitionParPoste plus bas) — audit tableau de bord 2026-08-31, décision
// utilisateur : remplace ce qui aurait été 4 fonctions dédiées (une par nouvelle carte "effectif").
// Aucune validation de `statutCode` ici (contrairement au poste, comparé à POSTES_BUREAU/HOTEL) :
// un code inconnu de l'entité renvoie simplement 0/une liste vide (le WHERE ne trouve rien), pas
// d'erreur — ce module n'a pas connaissance de la liste des statuts valides d'une entité (elle
// vit en config, voir workflow.config.json), la valider imposerait une dépendance supplémentaire
// pour un bénéfice marginal (un code invalide ne peut de toute façon rien casser).
function compterParStatut(bd, entiteId, statutCode, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', statutCode)
    .andWhere('dossiers.date_creation', '>=', debut)
    .andWhere('dossiers.date_creation', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.count('dossiers.id as total').first();
}

// Variante "liste" de compterParStatut ci-dessus (tableau consolidé cliquable, voir
// statistiquesService.resoudreListeIndicateur, préfixe 'statut:<code>') — date_cle = date_creation,
// même ancre de cohorte que listerInscrits/listerDossiersConvertis (pas la date d'ENTRÉE dans ce
// statut précis : celle-ci est affichée séparément dans la colonne "Dates clés", voir
// dossierRepository.listerDossiersParIds, calculée par un LEFT JOIN dédié par statut suivi — cette
// fonction-ci reste générique et ne fait qu'une requête simple sur `dossiers`, sans jointure vers
// `historique_statuts`).
function listerParStatut(bd, entiteId, statutCode, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', statutCode)
    .andWhere('dossiers.date_creation', '>=', debut)
    .andWhere('dossiers.date_creation', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.select('dossiers.id as dossier_id', 'dossiers.date_creation as date_cle');
}

// Effectif "historique" — nombre de dossiers DISTINCTS ayant eu AU MOINS UNE ligne
// historique_statuts avec ce statutCode dans la période, peu importe leur statut COURANT ensuite
// (audit tableau de bord 2026-08-31, 3e passe, décision utilisateur — corrige "Test réalisé
// (effectif)", qui utilisait à tort compterParStatut/statut COURANT : test_realise est un statut
// TRANSITOIRE, un dossier n'y reste que le temps de recevoir son verdict, donnant quasi toujours
// 0/proche de 0 avec cette approche). GÉNÉRIQUE, comme compterParStatut/listerParStatut ci-dessus,
// mais sur historique_statuts plutôt que sur le statut courant de `dossiers` — même patron EXACT
// que compterEnvoyesEnTest/listerEnvoyesEnTest ('test_planifie' en dur), généralisé à un statutCode
// arbitraire pour ne pas dupliquer une 3e fois la même requête. compterEnvoyesEnTest/
// listerEnvoyesEnTest restent volontairement INTACTES (pas refactorées pour appeler celle-ci) :
// fonctions déjà testées, aucune raison de les toucher pour ce correctif scopé à test_realise.
function compterParHistoriqueStatut(bd, entiteId, statutCode, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts')
    .join('dossiers', 'dossiers.id', 'historique_statuts.dossier_id')
    .join('statuts', 'statuts.id', 'historique_statuts.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', statutCode)
    .andWhere('historique_statuts.date_changement', '>=', debut)
    .andWhere('historique_statuts.date_changement', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.countDistinct('historique_statuts.dossier_id as total').first();
}

// Variante "liste" de compterParHistoriqueStatut ci-dessus — date_cle = MIN(date_changement),
// première entrée dans ce statut sur la période, même convention que listerEnvoyesEnTest.
function listerParHistoriqueStatut(bd, entiteId, statutCode, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts')
    .join('dossiers', 'dossiers.id', 'historique_statuts.dossier_id')
    .join('statuts', 'statuts.id', 'historique_statuts.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', statutCode)
    .andWhere('historique_statuts.date_changement', '>=', debut)
    .andWhere('historique_statuts.date_changement', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete
    .groupBy('historique_statuts.dossier_id')
    .select('historique_statuts.dossier_id as dossier_id', bd.raw('MIN(historique_statuts.date_changement) as date_cle'));
}

function requeteBaseRepartitionParPoste(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('evaluations_postes')
    .join('evaluations', 'evaluations.id', 'evaluations_postes.evaluation_id')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive);
  if (poste) {
    requete.andWhere('evaluations_postes.poste_code', poste);
  } else if (typePoste) {
    requete.whereIn('evaluations_postes.poste_code', codesPostesPourTypePoste(typePoste));
  }
  return requete;
}

// Stat 6a — nombre d'ÉVALUATIONS DISTINCTES par poste (une évaluation à plusieurs postes empilés
// ne compte qu'une fois par poste où elle apparaît, mais jamais deux fois pour le même poste).
function listerRepartitionParEvaluation(bd, entiteId, filtres) {
  return requeteBaseRepartitionParPoste(bd, entiteId, filtres)
    .groupBy('evaluations_postes.poste_code')
    .select('evaluations_postes.poste_code')
    .countDistinct('evaluations_postes.evaluation_id as nb_evaluations');
}

// Stat 6b — nombre d'OCCURRENCES poste (une évaluation à 2 postes compte pour 2) — distinct de
// listerRepartitionParEvaluation ci-dessus par construction (décision validée : ne pas confondre
// les deux échelles).
function listerRepartitionParOccurrence(bd, entiteId, filtres) {
  return requeteBaseRepartitionParPoste(bd, entiteId, filtres)
    .groupBy('evaluations_postes.poste_code')
    .select('evaluations_postes.poste_code')
    .count('* as nb_occurrences');
}

// Stat 6c — évaluations sans ligne evaluations_postes (poste générique/historique, voir migration
// 040) : comptées séparément sous "Non spécifié" côté service, jamais exclues silencieusement
// (décision validée). Sous un filtre poste/typePoste actif, ces évaluations n'ont par définition
// aucun poste connu à comparer au filtre : non pertinentes dans ce cas, court-circuité à 0 plutôt
// que de les compter hors filtre.
function compterEvaluationsSansPoste(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  if (typePoste || poste) return Promise.resolve({ total: '0' });
  return bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive)
    .whereNotExists(function () {
      this.select(1).from('evaluations_postes').whereRaw('evaluations_postes.evaluation_id = evaluations.id');
    })
    .count('evaluations.id as total')
    .first();
}

// Stat 7a — délai inscription -> premier test planifié. dossiers.date_creation est le seul point
// de départ disponible (aucune ligne historique_statuts n'existe pour le statut initial : la
// création du dossier écrit statut_id directement, sans passer par
// dossierRepository.enregistrerChangementStatut — voir migration 010/dossierRepository.js).
// NOT EXISTS d'une ligne test_planifie antérieure : ne garde que la PREMIÈRE occurrence par
// dossier (pas une reprogrammation après absence), pour mesurer le délai jusqu'à la première mise
// en test, pas jusqu'à la dernière planification en date.
function delaiInscriptionVersTestPlanifie(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts as premiere_planif')
    .join('dossiers', 'dossiers.id', 'premiere_planif.dossier_id')
    .join('statuts', 'statuts.id', 'premiere_planif.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', 'test_planifie')
    .andWhere('premiere_planif.date_changement', '>=', debut)
    .andWhere('premiere_planif.date_changement', '<', finExclusive)
    .whereNotExists(function () {
      this.select(1)
        .from('historique_statuts as anterieure')
        .join('statuts as statut_anterieure', 'statut_anterieure.id', 'anterieure.statut_id')
        .whereRaw('anterieure.dossier_id = premiere_planif.dossier_id')
        .andWhere('statut_anterieure.code', 'test_planifie')
        .andWhereRaw('anterieure.date_changement < premiere_planif.date_changement');
    });
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete
    .select(
      bd.raw('AVG(EXTRACT(EPOCH FROM (premiere_planif.date_changement - dossiers.date_creation)) / 86400) as moyenne_jours'),
      bd.raw('COUNT(*) as nb_dossiers'),
    )
    .first();
}

// Stat 7b — délai test réalisé -> verdict, entièrement sur historique_statuts (décision
// validée : jamais evaluations.date_evaluation). Chaque ligne "verdict" est appariée à la ligne
// PRÉCÉDENTE IMMÉDIATE de son dossier dans historique_statuts (n'importe quel statut, pas
// spécifiquement test_realise — voir correctif ci-dessous), et retenue seulement si ce
// prédécesseur immédiat est bien test_realise.
//
// Point de départ CORRIGÉ (audit 2026-08-24, workflow v5) : test_realise plutôt que test_planifie
// — l'ancien point de départ mesurait "planification -> verdict" (incluant l'attente jusqu'à la
// date du test lui-même, déjà couverte par le délai "inscription -> test planifié"), alors que le
// libellé affiché est "test -> verdict". Isole ainsi le délai d'évaluation/décision administrative,
// distinct du délai de planification déjà mesuré par delaiInscriptionVersTestPlanifie ci-dessus.
//
// Correctif 2026-09-01 (audit tableau de bord 2026-08-31, point #5) : contrairement à ce
// qu'affirmait ce commentaire jusqu'ici, valide_pret_embauche N'EST PAS atteignable QUE depuis
// test_realise — la transition "Formation validée" (SuiviFormation.jsx) y mène aussi depuis
// valide_envoi_formation, après un passage en formation potentiellement long. Avant ce correctif,
// le JOIN LATERAL appariait chaque verdict à la ligne test_realise la PLUS RÉCENTE qui le précède
// (peu importe ce qui s'intercalait entre les deux) : un dossier "Formation validée" longtemps
// après son test se voyait donc apparié au MÊME test_realise que son verdict initial
// (valide_envoi_formation), gonflant artificiellement la moyenne avec la durée de la formation
// elle-même. Le prédécesseur immédiat (n'importe quel statut, pas seulement test_realise) exclut
// naturellement ces lignes : leur prédécesseur immédiat est valide_envoi_formation, pas
// test_realise, sans qu'aucune donnée existante n'ait besoin d'être corrigée — la distinction vient
// de la séquence déjà enregistrée dans historique_statuts, pas d'un nouveau champ. Le codeAction
// dédié marquer_formation_validee (workflow.config.json, transitions.routes.js) empêche toute
// nouvelle occurrence du bug côté écriture ; ce recalcul répare aussi, sans aucune migration de
// données, tous les dossiers déjà passés par la formation avant ce correctif.
//
// Filtre poste/typePoste : historique_statuts n'a aucun lien vers evaluation_id/poste_code — la
// granularité "par tentative de test précise" n'est pas atteignable ici. Approximation assumée :
// un dossier est retenu dès qu'AU MOINS UNE de ses évaluations correspond au filtre (semi-join
// vers evaluations/evaluations_postes), pas seulement l'évaluation à l'origine de ce verdict
// précis.
function delaiTestVersVerdict(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts as verdict')
    .join('dossiers', 'dossiers.id', 'verdict.dossier_id')
    .join('statuts as statut_verdict', 'statut_verdict.id', 'verdict.statut_id')
    .joinRaw(
      `JOIN LATERAL (
         SELECT hs.date_changement, s.code AS code
         FROM historique_statuts hs
         JOIN statuts s ON s.id = hs.statut_id
         WHERE hs.dossier_id = verdict.dossier_id
           AND hs.date_changement < verdict.date_changement
         ORDER BY hs.date_changement DESC
         LIMIT 1
       ) AS precedent ON true`,
    )
    .where('dossiers.entite_id', entiteId)
    .whereIn('statut_verdict.code', ['invalide', 'valide_envoi_formation', 'valide_pret_embauche'])
    .andWhere('precedent.code', 'test_realise')
    .andWhere('verdict.date_changement', '>=', debut)
    .andWhere('verdict.date_changement', '<', finExclusive);

  if (typePoste || poste) {
    const sousRequetePostes = poste
      ? bd('evaluations_postes').select('evaluation_id').where('poste_code', poste)
      : bd('evaluations_postes').select('evaluation_id').whereIn('poste_code', codesPostesPourTypePoste(typePoste));
    requete.whereIn('dossiers.id', bd('evaluations').select('evaluations.dossier_id').whereIn('evaluations.id', sousRequetePostes));
  }

  return requete
    .select(
      bd.raw('AVG(EXTRACT(EPOCH FROM (verdict.date_changement - precedent.date_changement)) / 86400) as moyenne_jours'),
      bd.raw('COUNT(*) as nb_dossiers'),
    )
    .first();
}

// Stat 7c — délai formation : date d'ENTRÉE en valide_envoi_formation ("Formation validée"/
// "Formation non validée" pas encore décidée) -> date de SORTIE vers valide_pret_embauche
// (formation validée, codeAction dédié marquer_formation_validee) OU formation_non_validee
// (formation non validée, codeAction invalider_formation) — les deux SEULES destinations
// possibles depuis valide_envoi_formation qui concluent la formation (voir workflow.config.json ;
// replanifier_test y mène aussi mais reboucle vers test_planifie, ne conclut rien). Introduit le
// 2026-09-01 (audit tableau de bord 2026-08-31, point #5) en remplacement de la carte "Délai moyen
// test → verdict" du dashboard — voir le commentaire de delaiTestVersVerdict ci-dessus pour le
// distinguo désormais propre entre les deux mesures (verdict initial vs déroulement de la
// formation elle-même).
//
// Même patron EXACT que delaiTestVersVerdict : JOIN LATERAL vers la PROCHAINE occurrence (ASC,
// pas DESC) d'une des deux destinations après l'entrée en formation, filtré sur la date de SORTIE
// (comme verdict.date_changement ci-dessus, pas l'entrée) — cohérent avec
// delaiInscriptionVersTestPlanifie/delaiTestVersVerdict, qui filtrent tous deux sur la date de FIN
// du segment mesuré, pas sur son point de départ.
//
// Filtre poste/typePoste : même semi-join evaluations_postes que delaiTestVersVerdict ci-dessus
// (historique_statuts n'a toujours aucun lien direct vers poste_code) — pertinent ici aussi, la
// formation intervenant après une évaluation déjà rattachée à un poste.
function delaiFormation(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts as entree')
    .join('dossiers', 'dossiers.id', 'entree.dossier_id')
    .join('statuts as statut_entree', 'statut_entree.id', 'entree.statut_id')
    .joinRaw(
      `JOIN LATERAL (
         SELECT hs.date_changement
         FROM historique_statuts hs
         JOIN statuts s ON s.id = hs.statut_id
         WHERE hs.dossier_id = entree.dossier_id
           AND s.code IN ('valide_pret_embauche', 'formation_non_validee')
           AND hs.date_changement > entree.date_changement
         ORDER BY hs.date_changement ASC
         LIMIT 1
       ) AS sortie ON true`,
    )
    .where('dossiers.entite_id', entiteId)
    .andWhere('statut_entree.code', 'valide_envoi_formation')
    .andWhere('sortie.date_changement', '>=', debut)
    .andWhere('sortie.date_changement', '<', finExclusive);

  if (typePoste || poste) {
    const sousRequetePostes = poste
      ? bd('evaluations_postes').select('evaluation_id').where('poste_code', poste)
      : bd('evaluations_postes').select('evaluation_id').whereIn('poste_code', codesPostesPourTypePoste(typePoste));
    requete.whereIn('dossiers.id', bd('evaluations').select('evaluations.dossier_id').whereIn('evaluations.id', sousRequetePostes));
  }

  return requete
    .select(
      bd.raw('AVG(EXTRACT(EPOCH FROM (sortie.date_changement - entree.date_changement)) / 86400) as moyenne_jours'),
      bd.raw('COUNT(*) as nb_dossiers'),
    )
    .first();
}

// --- Variantes "liste de dossiers" des statistiques ci-dessus (dashboard KPI cliquable,
// tableau consolidé sous les cartes/graphiques, voir Indicateurs.jsx) ---
//
// Même WHERE/JOIN que la fonction compterX/listerX correspondante ci-dessus — seule la fin change
// (SELECT dossier_id + date_cle au lieu de count()/groupBy), pour que la liste affichée reste
// TOUJOURS cohérente avec le chiffre déjà affiché sur la carte/le segment cliqué. `date_cle` = la
// date qui a fait entrer ce dossier dans l'indicateur (date de création, de changement de statut
// ou d'évaluation selon le cas) — affichée telle quelle par le tableau front, pas recalculée.
//
// Regroupement par dossier_id (GROUP BY + MIN(date)) uniquement là où plusieurs lignes source
// peuvent exister pour un même dossier sur la période (ex. deux replanifications) : une ligne par
// dossier dans le résultat, jamais de doublon, même exigence que le tableau consolidé
// (statistiquesService.listerDossiersParIndicateurs). Les indicateurs déjà "un dossier = une
// ligne" par construction (inscrits, conversion, délai inscription→test, qui filtre déjà la
// première occurrence via NOT EXISTS) n'ont pas besoin de ce regroupement.

function listerInscrits(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('dossiers')
    .where('dossiers.entite_id', entiteId)
    .andWhere('dossiers.date_creation', '>=', debut)
    .andWhere('dossiers.date_creation', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.select('dossiers.id as dossier_id', 'dossiers.date_creation as date_cle');
}

function listerEnvoyesEnTest(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts')
    .join('dossiers', 'dossiers.id', 'historique_statuts.dossier_id')
    .join('statuts', 'statuts.id', 'historique_statuts.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', 'test_planifie')
    .andWhere('historique_statuts.date_changement', '>=', debut)
    .andWhere('historique_statuts.date_changement', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete
    .groupBy('historique_statuts.dossier_id')
    .select(
      'historique_statuts.dossier_id as dossier_id',
      bd.raw('MIN(historique_statuts.date_changement) as date_cle'),
    );
}

// resultatGlobal : 'valide' | 'invalide' — une des deux entrées du camembert "Tests réussis vs
// ratés" (Indicateurs.jsx).
function listerVerdicts(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}, resultatGlobal) {
  const requete = bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.resultat_global', resultatGlobal)
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive);
  filtrerPostesEvaluationParSemiJoin(requete, bd, { typePoste, poste });
  return requete
    .groupBy('evaluations.dossier_id')
    .select('evaluations.dossier_id as dossier_id', bd.raw('MIN(evaluations.date_evaluation) as date_cle'));
}

// orientation : 'envoi_formation' | 'pret_embauche' — une des deux entrées du camembert
// "Formation vs prêt à l'embauche" (Indicateurs.jsx). Implique déjà resultat_global = 'valide',
// même condition que compterOrientations. Filtre sur l'orientation EFFECTIVE (voir
// ORIENTATION_EFFECTIVE_SQL ci-dessus), pas evaluations.orientation seule — comparer `orientation`
// (paramètre, 'envoi_formation' ou 'pret_embauche') à l'expression COALESCE reste sans effet pour
// 'envoi_formation' (jamais produit par la déduction bureau, seulement par la valeur enregistrée),
// et inclut désormais les dossiers Inspecteur pour 'pret_embauche'.
function listerOrientations(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}, orientation) {
  const requete = bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.resultat_global', 'valide')
    .andWhereRaw(`${ORIENTATION_EFFECTIVE_SQL} = ?`, [orientation])
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive);
  filtrerPostesEvaluationParSemiJoin(requete, bd, { typePoste, poste });
  return requete
    .groupBy('evaluations.dossier_id')
    .select('evaluations.dossier_id as dossier_id', bd.raw('MIN(evaluations.date_evaluation) as date_cle'));
}

function listerDossiersConvertis(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('dossiers')
    .join('statuts', 'statuts.id', 'dossiers.statut_id')
    .where('dossiers.entite_id', entiteId)
    .whereIn('statuts.code', ['valide_pret_embauche', 'valide_envoi_formation'])
    .andWhere('dossiers.date_creation', '>=', debut)
    .andWhere('dossiers.date_creation', '<', finExclusive);
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.select('dossiers.id as dossier_id', 'dossiers.date_creation as date_cle');
}

function listerDelaiInscriptionVersTestPlanifie(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts as premiere_planif')
    .join('dossiers', 'dossiers.id', 'premiere_planif.dossier_id')
    .join('statuts', 'statuts.id', 'premiere_planif.statut_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('statuts.code', 'test_planifie')
    .andWhere('premiere_planif.date_changement', '>=', debut)
    .andWhere('premiere_planif.date_changement', '<', finExclusive)
    .whereNotExists(function () {
      this.select(1)
        .from('historique_statuts as anterieure')
        .join('statuts as statut_anterieure', 'statut_anterieure.id', 'anterieure.statut_id')
        .whereRaw('anterieure.dossier_id = premiere_planif.dossier_id')
        .andWhere('statut_anterieure.code', 'test_planifie')
        .andWhereRaw('anterieure.date_changement < premiere_planif.date_changement');
    });
  if (typePoste || poste) {
    joindreDisponibilitesDossier(requete, bd);
    filtrerPosteDossier(requete, { typePoste, poste });
  }
  return requete.select('premiere_planif.dossier_id as dossier_id', 'premiere_planif.date_changement as date_cle');
}

// Même JOIN LATERAL corrigé que delaiTestVersVerdict ci-dessus (prédécesseur immédiat = test_realise
// requis, voir son commentaire pour le correctif du 2026-09-01), indispensable ici aussi et pas
// seulement pour le calcul de moyenne : tout verdict dont le prédécesseur immédiat n'est pas
// test_realise (ex. "Formation validée" venant de valide_envoi_formation) est déjà exclu par cette
// jointure — sans elle, la liste inclurait des dossiers que le chiffre affiché sur la carte ne
// compte pas.
function listerDelaiTestVersVerdict(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts as verdict')
    .join('dossiers', 'dossiers.id', 'verdict.dossier_id')
    .join('statuts as statut_verdict', 'statut_verdict.id', 'verdict.statut_id')
    .joinRaw(
      `JOIN LATERAL (
         SELECT hs.date_changement, s.code AS code
         FROM historique_statuts hs
         JOIN statuts s ON s.id = hs.statut_id
         WHERE hs.dossier_id = verdict.dossier_id
           AND hs.date_changement < verdict.date_changement
         ORDER BY hs.date_changement DESC
         LIMIT 1
       ) AS precedent ON true`,
    )
    .where('dossiers.entite_id', entiteId)
    .whereIn('statut_verdict.code', ['invalide', 'valide_envoi_formation', 'valide_pret_embauche'])
    .andWhere('precedent.code', 'test_realise')
    .andWhere('verdict.date_changement', '>=', debut)
    .andWhere('verdict.date_changement', '<', finExclusive);

  if (typePoste || poste) {
    const sousRequetePostes = poste
      ? bd('evaluations_postes').select('evaluation_id').where('poste_code', poste)
      : bd('evaluations_postes').select('evaluation_id').whereIn('poste_code', codesPostesPourTypePoste(typePoste));
    requete.whereIn(
      'dossiers.id',
      bd('evaluations').select('evaluations.dossier_id').whereIn('evaluations.id', sousRequetePostes),
    );
  }

  return requete.select('verdict.dossier_id as dossier_id', 'verdict.date_changement as date_cle');
}

// Variante "liste" de delaiFormation ci-dessus — même JOIN LATERAL (prochaine sortie de formation
// après l'entrée), même patron que listerDelaiTestVersVerdict.
function listerDelaiFormation(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  const requete = bd('historique_statuts as entree')
    .join('dossiers', 'dossiers.id', 'entree.dossier_id')
    .join('statuts as statut_entree', 'statut_entree.id', 'entree.statut_id')
    .joinRaw(
      `JOIN LATERAL (
         SELECT hs.date_changement
         FROM historique_statuts hs
         JOIN statuts s ON s.id = hs.statut_id
         WHERE hs.dossier_id = entree.dossier_id
           AND s.code IN ('valide_pret_embauche', 'formation_non_validee')
           AND hs.date_changement > entree.date_changement
         ORDER BY hs.date_changement ASC
         LIMIT 1
       ) AS sortie ON true`,
    )
    .where('dossiers.entite_id', entiteId)
    .andWhere('statut_entree.code', 'valide_envoi_formation')
    .andWhere('sortie.date_changement', '>=', debut)
    .andWhere('sortie.date_changement', '<', finExclusive);

  if (typePoste || poste) {
    const sousRequetePostes = poste
      ? bd('evaluations_postes').select('evaluation_id').where('poste_code', poste)
      : bd('evaluations_postes').select('evaluation_id').whereIn('poste_code', codesPostesPourTypePoste(typePoste));
    requete.whereIn(
      'dossiers.id',
      bd('evaluations').select('evaluations.dossier_id').whereIn('evaluations.id', sousRequetePostes),
    );
  }

  return requete.select('entree.dossier_id as dossier_id', 'sortie.date_changement as date_cle');
}

// Un seul poste précis (posteCode) plutôt que le filtre poste/typePoste du tableau de bord — ce
// dernier reste appliqué en amont sur la période/le typePoste (cohérence avec le reste du
// dashboard) mais posteCode, plus spécifique (issu du clic sur UNE barre du graphique de
// répartition), prime toujours. GROUP BY dossier_id : une évaluation avec plusieurs postes
// n'apparaît qu'une fois par dossier dans la liste, même si listerRepartitionParEvaluation compte
// l'évaluation (pas le dossier) pour le chiffre affiché sur la barre — la déduplication par
// dossier demandée pour le tableau consolidé prime ici sur la fidélité exacte au chiffre affiché.
function listerRepartitionParPosteDossiers(bd, entiteId, { debut, finExclusive } = {}, posteCode) {
  return bd('evaluations_postes')
    .join('evaluations', 'evaluations.id', 'evaluations_postes.evaluation_id')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations_postes.poste_code', posteCode)
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive)
    .groupBy('evaluations.dossier_id')
    .select('evaluations.dossier_id as dossier_id', bd.raw('MIN(evaluations.date_evaluation) as date_cle'));
}

// Variante "liste" de compterEvaluationsSansPoste (barre "Non spécifié" du graphique de
// répartition par poste, voir Indicateurs.jsx) — même WHERE/whereNotExists, même court-circuit à
// liste vide sous un filtre poste/typePoste actif (ces évaluations n'ont par définition aucun
// poste connu à comparer au filtre). GROUP BY dossier_id : un dossier avec plusieurs évaluations
// "sans poste" sur la période (rare, mais possible) n'apparaît qu'une fois dans la liste, même
// principe que les autres variantes "liste" ci-dessus.
function listerEvaluationsSansPosteDossiers(bd, entiteId, { debut, finExclusive, typePoste, poste } = {}) {
  if (typePoste || poste) return Promise.resolve([]);
  return bd('evaluations')
    .join('dossiers', 'dossiers.id', 'evaluations.dossier_id')
    .where('dossiers.entite_id', entiteId)
    .andWhere('evaluations.date_evaluation', '>=', debut)
    .andWhere('evaluations.date_evaluation', '<', finExclusive)
    .whereNotExists(function () {
      this.select(1).from('evaluations_postes').whereRaw('evaluations_postes.evaluation_id = evaluations.id');
    })
    .groupBy('evaluations.dossier_id')
    .select('evaluations.dossier_id as dossier_id', bd.raw('MIN(evaluations.date_evaluation) as date_cle'));
}

module.exports = {
  compterInscrits,
  compterEnvoyesEnTest,
  compterVerdicts,
  compterOrientations,
  compterDossiersConvertis,
  compterParStatut,
  listerParStatut,
  compterParHistoriqueStatut,
  listerParHistoriqueStatut,
  listerRepartitionParEvaluation,
  listerRepartitionParOccurrence,
  compterEvaluationsSansPoste,
  delaiInscriptionVersTestPlanifie,
  delaiTestVersVerdict,
  delaiFormation,
  listerInscrits,
  listerEnvoyesEnTest,
  listerVerdicts,
  listerOrientations,
  listerDossiersConvertis,
  listerDelaiInscriptionVersTestPlanifie,
  listerDelaiTestVersVerdict,
  listerDelaiFormation,
  listerRepartitionParPosteDossiers,
  listerEvaluationsSansPosteDossiers,
};
