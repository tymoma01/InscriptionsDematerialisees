const { obtenirSecret } = require('../core/securite/keyVaultClient');
const { NODE_ENV } = require('../config/env');

// Deux bases Neon distinctes, une par environnement, chacune dans son propre secret Key Vault —
// pour que npm run dev (NODE_ENV=development par défaut, voir config/env.js, aucun NODE_ENV
// dans backend/.env) tape sur la base de dev, jamais sur celle de prod utilisée par le conteneur
// déployé (NODE_ENV=production, voir Dockerfile). Un script/job qui doit toucher la prod hors du
// conteneur (ex. futur Azure Container Apps Job) doit donc explicitement définir
// NODE_ENV=production dans son environnement.
const NOM_SECRET_CONNECTION_STRING = NODE_ENV === 'production' ? 'neon-connection-string' : 'neon-connection-string-dev';

function obtenirConnectionString() {
  return obtenirSecret(NOM_SECRET_CONNECTION_STRING);
}

module.exports = { obtenirConnectionString };
