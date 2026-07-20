const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const { obtenirConnectionString } = require('../../db/config');
const { SESSION_SECRET, NODE_ENV } = require('../../config/env');

// "Session courte (2h d'inactivité)" — CLAUDE.md, section Authentification et rôles.
const DUREE_INACTIVITE_MS = 2 * 60 * 60 * 1000;

// Pool pg dédié au store de session, séparé du pool knex (voir db/knex.js) — connect-pg-simple
// gère son propre cycle de vie de connexions et crée sa table `session` automatiquement
// (createTableIfMissing) si elle n'existe pas encore : elle n'est donc volontairement pas
// modélisée par une migration (voir docs/schema-bdd-proposition.md, fin de section 9).
let promesseMiddleware;

// Fabrique asynchrone : la connection string vient d'Azure Key Vault (obtenirConnectionString),
// donc le middleware ne peut être construit qu'après cet appel — c'est pour ça que app.js
// devient lui-même une fabrique asynchrone (creerApp) plutôt qu'un export synchrone de l'app.
function creerMiddlewareSession() {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET manquant (voir backend/.env.example) — impossible de démarrer sans secret de session.');
  }

  if (!promesseMiddleware) {
    promesseMiddleware = obtenirConnectionString().then((connectionString) => {
      const pool = new Pool({ connectionString });
      return session({
        store: new pgSession({ pool, createTableIfMissing: true }),
        secret: SESSION_SECRET,
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
