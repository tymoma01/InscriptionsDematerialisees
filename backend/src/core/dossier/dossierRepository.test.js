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
