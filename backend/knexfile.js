const { obtenirConnectionString } = require('./src/db/config');

module.exports = async () => ({
  client: 'pg',
  connection: await obtenirConnectionString(),
  migrations: {
    directory: './src/db/migrations',
    tableName: 'knex_migrations',
  },
});
