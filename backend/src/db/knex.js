const knex = require('knex');
const { obtenirConnectionString } = require('./config');

let promesseInstance;

// Instance knex partagée, créée une seule fois — la chaîne de connexion vient d'Azure Key
// Vault (voir config.js), jamais d'une variable d'environnement en clair.
function obtenirKnex() {
  if (!promesseInstance) {
    promesseInstance = obtenirConnectionString().then((connection) => knex({ client: 'pg', connection }));
  }
  return promesseInstance;
}

module.exports = { obtenirKnex };
