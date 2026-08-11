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
