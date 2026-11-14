const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');

// Les migrations récentes sont exécutées (up puis down) sur une instance knex PG réelle mais non connectée :
// chaque knex.raw est COMPILÉ comme à l'exécution, ce qui lève « Expected N bindings, saw M » dès qu'un « ? »
// littéral (opérateur JSON ?, ?|, ?& ou point d'interrogation d'une chaîne) est pris pour un paramètre. Une
// erreur de ce type est ainsi détectée par les tests et non au démarrage du serveur.
const bd = knex({ client: 'pg' });

function connexionEnregistreuse() {
  const requetes = [];
  const enregistrer = (requete) => {
    const { sql, bindings } = requete.toSQL();
    requetes.push({ sql, bindings });
    return Promise.resolve([]);
  };
  const constructeur = () => {
    const chaine = new Proxy(() => chaine, {
      get: (_cible, propriete) => {
        if (propriete === 'then') return undefined;
        if (propriete === 'returning') return () => Promise.resolve([{ id: 1 }]);
        if (['first', 'select'].includes(propriete)) return () => Promise.resolve(propriete === 'first' ? undefined : []);
        return () => chaine;
      },
    });
    return chaine;
  };
  const faux = (table) => constructeur(table);
  faux.raw = (sql, bindings) => enregistrer(bd.raw(sql, bindings));
  faux.fn = bd.fn;
  faux.schema = new Proxy({}, { get: () => () => Promise.resolve() });
  return { faux, requetes };
}

const MIGRATIONS_VERIFIEES = ['095_role_planning_tertiaire', '096_formulaire_dpae_tertiaire', '097_type_demande_unique_tertiaire'];

for (const nom of MIGRATIONS_VERIFIEES) {
  test(`Migration ${nom} : up puis down compilent leurs knex.raw sans erreur de paramètres`, async () => {
    const migration = require(`./migrations/${nom}`);
    const up = connexionEnregistreuse();
    await migration.up(up.faux);
    const down = connexionEnregistreuse();
    await migration.down(down.faux);
    assert.ok(up.requetes.length > 0, 'up exécute au moins une requête brute');
  });
}

test('Migration 097 : mise à jour de la configuration du Tertiaire (up) et retrait (down), sans opérateur JSON « ? »', async () => {
  const migration = require('./migrations/097_type_demande_unique_tertiaire');
  const up = connexionEnregistreuse();
  await migration.up(up.faux);
  assert.equal(up.requetes.length, 1);
  assert.match(up.requetes[0].sql, /jsonb_set\(dpae_config,\s*'\{tertiaire,formulaire,types_demande\}',\s*(?:\$1|\?)::jsonb,\s*true\)/);
  assert.match(up.requetes[0].sql, /jsonb_exists\(dpae_config, 'tertiaire'\)/);
  assert.deepEqual(JSON.parse(up.requetes[0].bindings[0]), migration.TYPES_DEMANDE);
  const down = connexionEnregistreuse();
  await migration.down(down.faux);
  assert.match(down.requetes[0].sql, /#- '\{tertiaire,formulaire,types_demande\}'/);
  assert.doesNotMatch(down.requetes[0].sql, /\? '/);
});

test('Le test détecte l’erreur d’origine : un « ? » littéral dans knex.raw lève « Expected 1 bindings, saw 2 »', () => {
  const ancien = "UPDATE entites SET dpae_config = jsonb_set(dpae_config, '{a}', ?::jsonb, true) WHERE dpae_config ? 'tertiaire'";
  assert.throws(() => bd.raw(ancien, ['{}']).toSQL(), /Expected 1 bindings, saw 2/);
  // Échappé, le même opérateur est accepté.
  assert.doesNotThrow(() => bd.raw(ancien.replace("dpae_config ? 'tertiaire'", "dpae_config \\? 'tertiaire'"), ['{}']).toSQL());
});
