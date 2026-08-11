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
