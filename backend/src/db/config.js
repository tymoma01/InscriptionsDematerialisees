const { obtenirSecret } = require('../core/securite/keyVaultClient');

const NOM_SECRET_CONNECTION_STRING = 'neon-connection-string';

function obtenirConnectionString() {
  return obtenirSecret(NOM_SECRET_CONNECTION_STRING);
}

module.exports = { obtenirConnectionString };
