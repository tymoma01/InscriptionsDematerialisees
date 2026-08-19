const test = require('node:test');
const assert = require('node:assert/strict');
const { construireVariablesEnvPg } = require('./pgDumpService');

test('construireVariablesEnvPg extrait hôte/port/base/utilisateur/mot de passe', () => {
  const variables = construireVariablesEnvPg('postgresql://alice:motdepasse@ep-test.eu-central-1.aws.neon.tech/inscriptions?sslmode=require');
  assert.deepEqual(variables, {
    PGHOST: 'ep-test.eu-central-1.aws.neon.tech',
    PGPORT: '5432',
    PGDATABASE: 'inscriptions',
    PGUSER: 'alice',
    PGPASSWORD: 'motdepasse',
    PGSSLMODE: 'require',
  });
});

test('construireVariablesEnvPg décode les caractères spéciaux du mot de passe (%-encodés)', () => {
  const variables = construireVariablesEnvPg('postgresql://alice:m%40t%2Fp%23sse@host/db');
  assert.equal(variables.PGPASSWORD, 'm@t/p#sse');
});

test('construireVariablesEnvPg impose sslmode=require si absent de la connection string', () => {
  const variables = construireVariablesEnvPg('postgresql://alice:pass@host/db');
  assert.equal(variables.PGSSLMODE, 'require');
});

test('construireVariablesEnvPg respecte un sslmode explicite différent', () => {
  const variables = construireVariablesEnvPg('postgresql://alice:pass@host/db?sslmode=verify-full');
  assert.equal(variables.PGSSLMODE, 'verify-full');
});

test('construireVariablesEnvPg rejette une connection string qui n\'est pas une URL valide', () => {
  assert.throws(() => construireVariablesEnvPg('pas-une-url'), /invalide/);
});

test('construireVariablesEnvPg rejette une connection string sans nom de base', () => {
  assert.throws(() => construireVariablesEnvPg('postgresql://alice:pass@host/'), /incomplète/);
});
