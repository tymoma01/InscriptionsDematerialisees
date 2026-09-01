const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const statistiquesRepository = require('./statistiquesRepository');

// `bd` : instance knex RÉELLE (pas un mock) mais JAMAIS connectée — `client: 'pg'` suffit à
// générer du SQL valide et à le récupérer via `.toString()`, sans dépendre d'une connexion Neon
// réelle. Cohérent avec le reste de la suite (statistiquesService.test.js mocke entièrement le
// repository ; aucun test de ce projet ne se connecte à une vraie base) : ici, on vérifie la
// REQUÊTE CONSTRUITE elle-même plutôt que son résultat, seule façon de couvrir une expression SQL
// (COALESCE/CASE) sans base de données réelle ni mock qui masquerait la régression testée.
const bd = knex({ client: 'pg' });
const ENTITE_ID = 1;
const FILTRES = { debut: new Date('2026-07-01T00:00:00.000Z'), finExclusive: new Date('2026-08-01T00:00:00.000Z') };

// Couvre le correctif du 2026-08-12 (audit dossiers #89/#74) : evaluations.orientation reste
// TOUJOURS NULL pour une évaluation soumise par le rôle Inspecteur, par conception
// (evaluationEngine.js.enregistrerEvaluation) — sans la jointure vers `statuts` et le repli
// COALESCE/CASE ci-dessous, ces dossiers disparaîtraient silencieusement du camembert "Formation
// vs prêt à l'embauche" malgré un verdict positif. Règle GÉNÉRALE (pas un correctif ponctuel sur
// des ids précis) : ce test verrouille la présence de la règle dans la requête, pas un jeu de
// données figé.
test('compterOrientations joint `statuts` et déduit "pret_embauche" par COALESCE quand evaluations.orientation est NULL (rôle Inspecteur, statut valide_pret_embauche)', () => {
  const sql = statistiquesRepository.compterOrientations(bd, ENTITE_ID, FILTRES).toString();
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "dossiers"\."statut_id"/i);
  assert.match(
    sql,
    /COALESCE\(\s*evaluations\.orientation,\s*CASE WHEN statuts\.code = 'valide_pret_embauche' THEN 'pret_embauche' END\s*\)/,
  );
});

test('listerOrientations("pret_embauche") filtre sur l\'orientation EFFECTIVE (valeur enregistrée OU statut valide_pret_embauche), pas evaluations.orientation seule', () => {
  const sql = statistiquesRepository.listerOrientations(bd, ENTITE_ID, FILTRES, 'pret_embauche').toString();
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "dossiers"\."statut_id"/i);
  assert.match(sql, /CASE WHEN statuts\.code = 'valide_pret_embauche' THEN 'pret_embauche' END/);
  assert.match(sql, /= 'pret_embauche'/);
});

// "envoi_formation" n'est JAMAIS produit par la déduction CASE (seule "pret_embauche" y figure,
// voir ORIENTATION_EFFECTIVE_SQL) — comparer l'expression COALESCE à 'envoi_formation' reste donc
// mathématiquement équivalent à comparer evaluations.orientation directement, sans traitement
// spécial : ce test verrouille que le comportement reste bien inchangé pour ce cas (décision
// utilisateur, 2026-08-12), sans qu'un futur refactor ne l'étende par erreur à une déduction bureau
// qui n'a pas de sens pour la filière formation.
test('listerOrientations("envoi_formation") reste inchangé : comparaison sur la même expression, jamais déduite par CASE pour cette valeur', () => {
  const sql = statistiquesRepository.listerOrientations(bd, ENTITE_ID, FILTRES, 'envoi_formation').toString();
  assert.match(sql, /= 'envoi_formation'/);
  assert.doesNotMatch(sql, /'envoi_formation'.*CASE WHEN/);
});

// compterVerdicts/listerVerdicts/compterOrientations/listerOrientations (correctif 2026-09-02,
// audit dashboard : dossier #88, 3 évaluations dont 1 invalide puis 2 valides) — ces 4 fonctions
// doivent désormais toutes exclure les évaluations qui ne sont pas la DERNIÈRE de leur dossier
// (filtrerDerniereEvaluation, anti-jointure sur `evaluations` elle-même), pour qu'un dossier retesté
// ne compte/n'apparaisse plus qu'une seule fois, sous son verdict/orientation le plus récent.
test('compterVerdicts exclut les évaluations qui ne sont pas la DERNIÈRE de leur dossier (anti-jointure sur evaluations)', () => {
  const sql = statistiquesRepository.compterVerdicts(bd, ENTITE_ID, FILTRES).toString();
  assert.match(sql, /not exists/i);
  assert.match(sql, /plus_recente\.dossier_id = evaluations\.dossier_id/);
  assert.match(sql, /"plus_recente"\."date_evaluation" > evaluations\.date_evaluation/);
});

test('listerVerdicts exclut les évaluations qui ne sont pas la DERNIÈRE de leur dossier, et ne fait plus de MIN/GROUP BY (un seul candidat possible par dossier)', () => {
  const sql = statistiquesRepository.listerVerdicts(bd, ENTITE_ID, FILTRES, 'valide').toString();
  assert.match(sql, /not exists/i);
  assert.doesNotMatch(sql, /MIN\(evaluations\.date_evaluation\)/);
  assert.match(sql, /"evaluations"\."date_evaluation" as "date_cle"/);
});

test('compterOrientations exclut les évaluations qui ne sont pas la DERNIÈRE de leur dossier (toutes confondues, avant le filtre resultat_global)', () => {
  const sql = statistiquesRepository.compterOrientations(bd, ENTITE_ID, FILTRES).toString();
  assert.match(sql, /not exists/i);
  assert.match(sql, /plus_recente\.dossier_id = evaluations\.dossier_id/);
});

test('listerOrientations exclut les évaluations qui ne sont pas la DERNIÈRE de leur dossier, et ne fait plus de MIN/GROUP BY', () => {
  const sql = statistiquesRepository.listerOrientations(bd, ENTITE_ID, FILTRES, 'envoi_formation').toString();
  assert.match(sql, /not exists/i);
  assert.doesNotMatch(sql, /MIN\(evaluations\.date_evaluation\)/);
  assert.match(sql, /"evaluations"\."date_evaluation" as "date_cle"/);
});

// compterParStatut/compterParHistoriqueStatut + listerParStatut/listerParHistoriqueStatut (audit
// tableau de bord 2026-08-31, décision utilisateur ; retirées le 2026-09-02 lors de la bascule
// "Volumétrie par statut", puis RESTAURÉES le même jour — décision affinée : deux sections
// distinctes, "Effectifs par statut" (ces 4 fonctions, dossiers DISTINCTS) et "Volumétrie sur la
// période" (compterOccurrencesHistorique/compterOccurrencesFormationValidee plus bas, occurrences
// BRUTES) coexistent, ce ne sont pas des remplaçantes l'une de l'autre). Les fonctions "lister"
// restent aussi la source du mécanisme générique 'statut:<code>'
// (statistiquesService.resoudreListeIndicateur), pour n'importe quel code, pas seulement les 4
// affichés en carte.
test('compterParStatut filtre sur le statut COURANT du dossier (jointure statuts) et déduplique par countDistinct', () => {
  const sql = statistiquesRepository.compterParStatut(bd, ENTITE_ID, 'embauche', FILTRES).toString();
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "dossiers"\."statut_id"/i);
  assert.match(sql, /"statuts"\."code" = 'embauche'/);
  assert.match(sql, /count\("dossiers"\."id"\) as "total"/i);
});

test('compterParHistoriqueStatut filtre sur historique_statuts.date_changement et déduplique par countDistinct(dossier_id)', () => {
  const sql = statistiquesRepository.compterParHistoriqueStatut(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /inner join "dossiers" on "dossiers"\."id" = "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.match(sql, /count\(distinct "historique_statuts"\."dossier_id"\) as "total"/i);
});

test('listerParStatut filtre sur le statut COURANT du dossier (jointure statuts) et sur la cohorte date_creation, pour un code de statut arbitraire', () => {
  const sql = statistiquesRepository.listerParStatut(bd, ENTITE_ID, 'embauche', FILTRES).toString();
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "dossiers"\."statut_id"/i);
  assert.match(sql, /"statuts"\."code" = 'embauche'/);
  assert.match(sql, /"dossiers"\."date_creation" >=/);
  assert.match(sql, /"dossiers"\."date_creation" </);
  assert.match(sql, /"dossiers"\."id" as "dossier_id"/);
  assert.match(sql, /"dossiers"\."date_creation" as "date_cle"/);
});

test('listerParHistoriqueStatut filtre sur historique_statuts.date_changement (pas dossiers.date_creation), pour un code de statut arbitraire', () => {
  const sql = statistiquesRepository.listerParHistoriqueStatut(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /inner join "dossiers" on "dossiers"\."id" = "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "historique_statuts"\."statut_id"/i);
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.match(sql, /"historique_statuts"\."date_changement" >=/);
  assert.match(sql, /"historique_statuts"\."date_changement" </);
  assert.match(sql, /group by "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /MIN\(historique_statuts\.date_changement\) as date_cle/);
});

// Section "Volumétrie sur la période" (audit dashboard 2026-09-02, décision affinée le même jour :
// SÉPARÉE de "Effectifs par statut" ci-dessus, coexiste avec elle plutôt que de la remplacer) —
// comptage d'OCCURRENCES, jamais de dossiers distincts. Ces tests verrouillent l'absence de
// dédoublonnage (pas de countDistinct/GROUP BY) — le point central de cette section, pas un détail
// accessoire.
test('compterOccurrencesHistorique compte TOUTES les lignes historique_statuts du bon statut, sans countDistinct ni GROUP BY, pour un code arbitraire', () => {
  const sql = statistiquesRepository.compterOccurrencesHistorique(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /inner join "dossiers" on "dossiers"\."id" = "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.doesNotMatch(sql, /distinct/i);
  assert.doesNotMatch(sql, /group by/i);
  assert.match(sql, /count\(\*\) as "total"/i);
});

// Ancrée sur l'ENTRÉE (comme delaiFormation), pas une recherche arrière depuis la sortie (essayé
// d'abord, abandonné : test_realise et valide_envoi_formation partagent parfois un date_changement
// RIGOUREUSEMENT IDENTIQUE — même transaction evaluationEngine — rendant une recherche arrière sans
// tie-breaker non déterministe, démontré sur le dossier #88). Ce test verrouille la direction de
// recherche (ASC depuis l'entrée), pas l'inverse.
test('compterOccurrencesFormationValidee part de l\'entrée valide_envoi_formation et cherche la PROCHAINE occurrence (ASC), pas une recherche arrière depuis la sortie', () => {
  const sql = statistiquesRepository.compterOccurrencesFormationValidee(bd, ENTITE_ID, FILTRES).toString();
  assert.match(sql, /"statut_entree"\."code" = 'valide_envoi_formation'/);
  assert.match(sql, /"sortie"\."code" = 'valide_pret_embauche'/);
  assert.match(sql, /ORDER BY hs\.date_changement ASC\s*\n?\s*LIMIT 1/);
  assert.doesNotMatch(sql, /ORDER BY hs\.date_changement DESC/);
  assert.doesNotMatch(sql, /distinct/i);
  assert.doesNotMatch(sql, /group by/i);
});

// listerOccurrencesHistorique/listerOccurrencesFormationValidee (audit dashboard 2026-09-02, cartes
// "Volumétrie sur la période" rendues cliquables/filtrantes) — pendants "lister" des deux fonctions
// "compter" ci-dessus, MÊME requête sans le count : une ligne par OCCURRENCE, jamais dédupliquée
// (pas de countDistinct/GROUP BY ici non plus), avec dossier_id/date_cle en colonnes de sortie —
// même contrat que listerParStatut/listerDelaiFormation.
test('listerOccurrencesHistorique reprend la même requête que compterOccurrencesHistorique, avec dossier_id/date_cle en sortie', () => {
  const sql = statistiquesRepository.listerOccurrencesHistorique(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /inner join "dossiers" on "dossiers"\."id" = "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.doesNotMatch(sql, /distinct/i);
  assert.doesNotMatch(sql, /group by/i);
  assert.match(sql, /"historique_statuts"\."dossier_id" as "dossier_id"/);
  assert.match(sql, /"historique_statuts"\."date_changement" as "date_cle"/);
});

test('listerOccurrencesFormationValidee reprend le même JOIN LATERAL que compterOccurrencesFormationValidee, avec dossier_id/date_cle en sortie', () => {
  const sql = statistiquesRepository.listerOccurrencesFormationValidee(bd, ENTITE_ID, FILTRES).toString();
  assert.match(sql, /"statut_entree"\."code" = 'valide_envoi_formation'/);
  assert.match(sql, /"sortie"\."code" = 'valide_pret_embauche'/);
  assert.match(sql, /ORDER BY hs\.date_changement ASC\s*\n?\s*LIMIT 1/);
  assert.doesNotMatch(sql, /distinct/i);
  assert.doesNotMatch(sql, /group by/i);
  assert.match(sql, /"entree"\."dossier_id" as "dossier_id"/);
  assert.match(sql, /"sortie"\."date_changement" as "date_cle"/);
});

// delaiTestVersVerdict/listerDelaiTestVersVerdict (correctif 2026-09-01, audit tableau de bord
// 2026-08-31, point #5) — chaque verdict n'est retenu que si le PRÉDÉCESSEUR IMMÉDIAT de son
// dossier dans historique_statuts (n'importe quel statut, pas seulement test_realise) est bien
// test_realise. Ces tests verrouillent la requête générée (pas de connexion réelle, voir l'en-tête
// de ce fichier) : le JOIN LATERAL ne filtre plus sur `s.code = 'test_realise'` À L'INTÉRIEUR de la
// sous-requête (n'importe quel statut peut être le prédécesseur), le filtre 'test_realise' se
// déplace sur `precedent.code` dans le WHERE externe.
test("delaiTestVersVerdict apparie chaque verdict à son PRÉDÉCESSEUR IMMÉDIAT (n'importe quel statut) et exige que ce prédécesseur soit test_realise", () => {
  const sql = statistiquesRepository.delaiTestVersVerdict(bd, ENTITE_ID, FILTRES).toString();
  assert.doesNotMatch(
    sql,
    /AND s\.code = 'test_realise'/,
    'le JOIN LATERAL ne doit plus filtrer sur test_realise à l’intérieur de la sous-requête (prédécesseur = n’importe quel statut)',
  );
  assert.match(sql, /ORDER BY hs\.date_changement DESC\s*\n?\s*LIMIT 1/);
  assert.match(sql, /"precedent"\."code" = 'test_realise'/);
  assert.match(
    sql,
    /verdict\.date_changement - precedent\.date_changement/,
    'la moyenne doit se baser sur le prédécesseur immédiat, pas un ancien alias test_realise_le',
  );
});

test('listerDelaiTestVersVerdict reprend le même JOIN LATERAL corrigé que delaiTestVersVerdict', () => {
  const sql = statistiquesRepository.listerDelaiTestVersVerdict(bd, ENTITE_ID, FILTRES).toString();
  assert.doesNotMatch(sql, /AND s\.code = 'test_realise'/);
  assert.match(sql, /"precedent"\."code" = 'test_realise'/);
  assert.match(sql, /"verdict"\."dossier_id" as "dossier_id"/);
  assert.match(sql, /"verdict"\."date_changement" as "date_cle"/);
});

// delaiFormation/listerDelaiFormation (introduits le 2026-09-01, corrigés le 2026-09-02, audit
// dashboard dossier #88) — entrée en valide_envoi_formation -> sortie vers valide_pret_embauche OU
// formation_non_validee. JOIN LATERAL vers le PRÉDÉCESSEUR IMMÉDIAT (n'importe quel statut, pas
// seulement les deux codes de sortie), retenu seulement si CE prédécesseur est bien l'un des deux —
// même correctif que delaiTestVersVerdict : avant, le JOIN LATERAL cherchait la PROCHAINE occurrence
// du bon type dans le futur, peu importe ce qui s'intercalait (ex. un retour en test_planifie via
// replanifier_test), pouvant apparier une boucle de formation INTERROMPUE à la sortie d'une boucle
// ULTÉRIEURE (dossier #88 : entrée du 27/08 repartie en test 50 min plus tard, appariée à tort à la
// sortie du 28/08 14:24 qui appartenait en réalité à l'entrée suivante, déjà correctement comptée).
test("delaiFormation apparie chaque entrée à son PRÉDÉCESSEUR IMMÉDIAT et exige que ce prédécesseur soit une sortie valide (valide_pret_embauche ou formation_non_validee)", () => {
  const sql = statistiquesRepository.delaiFormation(bd, ENTITE_ID, FILTRES).toString();
  assert.match(sql, /"statut_entree"\."code" = 'valide_envoi_formation'/);
  assert.doesNotMatch(
    sql,
    /AND s\.code IN \('valide_pret_embauche', 'formation_non_validee'\)/,
    'le JOIN LATERAL ne doit plus filtrer sur le type de statut à l’intérieur de la sous-requête (prédécesseur = n’importe quel statut)',
  );
  assert.match(sql, /ORDER BY hs\.date_changement ASC\s*\n?\s*LIMIT 1/);
  assert.match(sql, /"sortie"\."code" in \('valide_pret_embauche', 'formation_non_validee'\)/);
  assert.match(sql, /"sortie"\."date_changement" >=/);
  assert.match(sql, /"sortie"\."date_changement" </);
  assert.match(sql, /sortie\.date_changement - entree\.date_changement/);
});

test('listerDelaiFormation reprend le même JOIN LATERAL corrigé que delaiFormation, avec dossier_id/date_cle', () => {
  const sql = statistiquesRepository.listerDelaiFormation(bd, ENTITE_ID, FILTRES).toString();
  assert.doesNotMatch(sql, /AND s\.code IN \('valide_pret_embauche', 'formation_non_validee'\)/);
  assert.match(sql, /"sortie"\."code" in \('valide_pret_embauche', 'formation_non_validee'\)/);
  assert.match(sql, /"statut_entree"\."code" = 'valide_envoi_formation'/);
  assert.match(sql, /"entree"\."dossier_id" as "dossier_id"/);
  assert.match(sql, /"sortie"\."date_changement" as "date_cle"/);
});
