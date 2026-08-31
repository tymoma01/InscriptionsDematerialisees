const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

const dossierRepository = require('./dossierRepository');

// `bd` : instance knex RÉELLE mais JAMAIS connectée — `client: 'pg'` suffit à générer du SQL
// valide et à le récupérer via `.toString()`, sans dépendre d'une connexion Neon réelle. Même
// principe que statistiquesRepository.test.js.
const bd = knex({ client: 'pg' });

// Couvre le correctif du 2026-08-12 (audit dossiers #89/#74) : le badge "Indicateurs"/la ligne
// "Dates clés" du tableau détaillé (colonne verdict_orientation) doivent refléter la MÊME
// orientation EFFECTIVE que le camembert "Formation vs prêt à l'embauche"
// (statistiquesRepository.compterOrientations/listerOrientations) — sinon le camembert compterait
// un dossier Inspecteur sous "Prêt à l'embauche" alors que son badge/sa date resteraient invisibles
// dans le tableau détaillé, rouvrant l'incohérence par un autre chemin.
test('listerDossiersParIds déduit verdict_orientation="pret_embauche" par COALESCE quand evaluation_verdict.orientation est NULL (rôle Inspecteur, statut valide_pret_embauche)', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  assert.match(
    sql,
    /COALESCE\(\s*evaluation_verdict\.orientation,\s*CASE WHEN statuts\.code = 'valide_pret_embauche' THEN 'pret_embauche' END\s*\)\s*as verdict_orientation/,
  );
});

// Colonne "Dates clés" enrichie pour les 4 nouvelles cartes "Effectifs par statut" (audit tableau
// de bord 2026-08-31, décision utilisateur) — une jointure LEFT JOIN dédiée par statut suivi
// (joindreDateEntreeStatut), MAX(historique_statuts.date_changement), même calcul que
// listerSuiviFormation.dates_entree_formation (voir plus bas) — pas un mécanisme dynamique unique,
// seulement 4 statuts concernés pour l'instant.
test('listerDossiersParIds joint une date d’entrée (MAX historique_statuts) par statut pour les 4 nouvelles cartes "Effectifs par statut"', () => {
  const sql = dossierRepository.listerDossiersParIds(bd, 1, [74, 89]).toString();
  for (const statutCode of ['test_realise', 'valide_pret_embauche', 'formation_non_validee', 'embauche']) {
    assert.match(sql, new RegExp(`"statuts_${statutCode}"\\."code" = '${statutCode}'`));
    assert.match(sql, new RegExp(`MAX\\(historique_statuts\\.date_changement\\) as date_entree_${statutCode}`));
    assert.match(sql, new RegExp(`"dates_${statutCode}"\\."date_entree_${statutCode}"`));
  }
});

test('listerDossiersParIds retourne un tableau vide sans construire de requête pour une liste de dossiers vide (comportement inchangé)', async () => {
  const resultat = await dossierRepository.listerDossiersParIds(bd, 1, []);
  assert.deepEqual(resultat, []);
});

// Suivi de formation (audit 2026-08-28, point 1 : dossiers déjà traités restent visibles) — la
// sous-requête historique_statuts reste fixée sur 'valide_envoi_formation' (définit le PÉRIMÈTRE
// de la page), tandis que le filtre sur le statut COURANT porte sur les 3 issues possibles, pas
// seulement 'valide_envoi_formation'.
test('listerSuiviFormation filtre historique_statuts sur valide_envoi_formation (périmètre) et le statut courant sur les 3 issues possibles', () => {
  const sql = dossierRepository.listerSuiviFormation(bd, 1).toString();
  assert.match(sql, /"statuts_formation"\."code" = 'valide_envoi_formation'/);
  assert.match(
    sql,
    /"statuts"\."code" in \('valide_envoi_formation', 'valide_pret_embauche', 'formation_non_validee'\)/,
  );
  assert.match(sql, /MAX\(historique_statuts\.date_changement\) as date_entree_statut/);
  assert.match(sql, /"dossiers"\."entite_id" = 1/);
  assert.match(sql, /dates_entree_formation"\."dossier_id" is not null/);
});

// Point 2 : le formateur affiché doit venir de la DERNIÈRE évaluation soumise (evaluations,
// triée par date_evaluation), jamais d'un simple "rendez-vous le plus récent" qui pourrait ne
// jamais avoir été évalué (replanifié/annulé après coup).
test('listerSuiviFormation résout le formateur via une LATERAL JOIN sur evaluations triée par date_evaluation DESC LIMIT 1, jamais rendezvous.formateur_id', () => {
  const sql = dossierRepository.listerSuiviFormation(bd, 1).toString();
  assert.match(sql, /LEFT JOIN LATERAL[\s\S]*FROM evaluations e[\s\S]*ORDER BY e\.date_evaluation DESC[\s\S]*LIMIT 1/);
  assert.doesNotMatch(sql, /rendezvous/);
});

// Onglet "Formation" (audit 2026-08-28) — scopé au dossier ET à l'entité (garde IDOR), filtré sur
// les 3 statuts formation, trié du plus ANCIEN au plus récent (c'est dossierService qui inverse
// pour l'affichage, voir construireHistoriqueFormation) — l'inverse de listerSuiviFormation
// ci-dessus (desc), nécessaire ici pour que l'algorithme d'association envoi/résultat parcoure
// l'historique dans l'ordre chronologique réel.
test("listerHistoriqueFormation scope par dossier ET entité, filtre les 3 statuts formation, trie par date_changement ASC", () => {
  const sql = dossierRepository.listerHistoriqueFormation(bd, 1, 42).toString();
  assert.match(sql, /"dossiers"\."id" = 42/);
  assert.match(sql, /"dossiers"\."entite_id" = 1/);
  assert.match(
    sql,
    /"statuts"\."code" in \('valide_envoi_formation', 'valide_pret_embauche', 'formation_non_validee'\)/,
  );
  assert.match(sql, /order by "historique_statuts"\."date_changement" asc/);
});
