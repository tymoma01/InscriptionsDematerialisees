const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const { obtenirConnectionString } = require('../../db/config');
const { obtenirSecret } = require('../securite/keyVaultClient');
const { NODE_ENV } = require('../../config/env');

const NOM_SECRET_SESSION = 'session-secret';

// "Session courte (2h d'inactivité)" — CLAUDE.md, section Authentification et rôles.
const DUREE_INACTIVITE_MS = 2 * 60 * 60 * 1000;

// Pool pg dédié au store de session, séparé du pool knex (voir db/knex.js) — connect-pg-simple
// gère son propre cycle de vie de connexions et crée sa table `session` automatiquement
// (createTableIfMissing) si elle n'existe pas encore : elle n'est donc volontairement pas
// modélisée par une migration (voir docs/schema-bdd-proposition.md, fin de section 9).
let promesseMiddleware;

// Fabrique asynchrone : la connection string et le secret de session viennent tous deux d'Azure
// Key Vault (obtenirConnectionString / obtenirSecret), donc le middleware ne peut être construit
// qu'après ces appels — c'est pour ça que app.js devient lui-même une fabrique asynchrone
// (creerApp) plutôt qu'un export synchrone de l'app. Un échec de récupération (Key Vault
// injoignable, secret absent...) remonte naturellement, comme pour la connection string Neon.
function creerMiddlewareSession() {
  if (!promesseMiddleware) {
    promesseMiddleware = Promise.all([
      obtenirConnectionString(),
      obtenirSecret(NOM_SECRET_SESSION),
    ]).then(([connectionString, secretSession]) => {
      const pool = new Pool({ connectionString });
      return session({
        store: new pgSession({ pool, createTableIfMissing: true }),
        secret: secretSession,
        name: 'sid',
        resave: false,
        saveUninitialized: false,
        // Renouvelle l'expiration à chaque requête authentifiée : "2h d'inactivité", pas 2h fixes
        // depuis la connexion.
        rolling: true,
        cookie: {
          httpOnly: true,
          // secure:true bloquerait le cookie en HTTP local (pas de reverse proxy TLS en dev) —
          // CLAUDE.md recommande HTTPS même en local (reverse proxy, certificat auto-signé), mais
          // tant que ce point n'est pas mis en place, secure reste gated par NODE_ENV. À revoir
          // avec le développeur senior une fois le reverse proxy local en place (voir CLAUDE.auth-rbac.md).
          secure: NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: DUREE_INACTIVITE_MS,
        },
      });
    });
    promesseMiddleware.catch(() => {
      promesseMiddleware = undefined;
    });
  }

  return promesseMiddleware;
}

module.exports = { creerMiddlewareSession };
