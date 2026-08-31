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

// compterParStatut/listerParStatut (audit tableau de bord 2026-08-31, décision utilisateur) —
// fonctions GÉNÉRIQUES pour les cartes "Effectifs par statut" : un seul couple de fonctions pour
// n'importe quel code de statut de l'entité, pas une fonction dédiée par statut (voir
// statistiquesService.CODES_STATUTS_EFFECTIF_ACCECIT/resoudreListeIndicateur). Ces deux tests
// verrouillent que n'importe quel `statutCode` produit bien un WHERE sur `statuts.code`, filtré sur
// la MÊME cohorte (dossiers.date_creation) que compterInscrits/compterDossiersConvertis.
test('compterParStatut filtre sur le statut COURANT du dossier (jointure statuts) et sur la cohorte date_creation, pour un code de statut arbitraire', () => {
  const sql = statistiquesRepository.compterParStatut(bd, ENTITE_ID, 'embauche', FILTRES).toString();
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "dossiers"\."statut_id"/i);
  assert.match(sql, /"statuts"\."code" = 'embauche'/);
  assert.match(sql, /"dossiers"\."date_creation" >=/);
  assert.match(sql, /"dossiers"\."date_creation" </);
});

test('listerParStatut reprend le même filtre que compterParStatut, avec dossier_id/date_creation en date_cle (même ancre de cohorte que listerInscrits)', () => {
  const sql = statistiquesRepository.listerParStatut(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.match(sql, /"dossiers"\."id" as "dossier_id"/);
  assert.match(sql, /"dossiers"\."date_creation" as "date_cle"/);
});

// compterParHistoriqueStatut/listerParHistoriqueStatut (audit tableau de bord 2026-08-31, 3e passe,
// correctif "Test réalisé (effectif)") — même patron EXACT que compterEnvoyesEnTest/
// listerEnvoyesEnTest ('test_planifie' en dur), généralisé à un statutCode arbitraire : filtre sur
// historique_statuts.date_changement (pas dossiers.date_creation comme compterParStatut ci-dessus)
// et compte les dossiers DISTINCTS, peu importe leur statut courant ensuite — nécessaire pour un
// statut TRANSITOIRE comme test_realise, où compterParStatut (statut courant) donnerait quasi
// toujours 0.
test('compterParHistoriqueStatut filtre sur historique_statuts.date_changement (pas dossiers.date_creation) et compte les dossiers DISTINCTS', () => {
  const sql = statistiquesRepository.compterParHistoriqueStatut(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /inner join "dossiers" on "dossiers"\."id" = "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /inner join "statuts" on "statuts"\."id" = "historique_statuts"\."statut_id"/i);
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.match(sql, /"historique_statuts"\."date_changement" >=/);
  assert.match(sql, /"historique_statuts"\."date_changement" </);
  assert.match(sql, /count\(distinct "historique_statuts"\."dossier_id"\)/i);
});

test('listerParHistoriqueStatut reprend le même filtre que compterParHistoriqueStatut, avec MIN(date_changement) en date_cle (même convention que listerEnvoyesEnTest)', () => {
  const sql = statistiquesRepository.listerParHistoriqueStatut(bd, ENTITE_ID, 'test_realise', FILTRES).toString();
  assert.match(sql, /"statuts"\."code" = 'test_realise'/);
  assert.match(sql, /group by "historique_statuts"\."dossier_id"/i);
  assert.match(sql, /MIN\(historique_statuts\.date_changement\) as date_cle/);
});
