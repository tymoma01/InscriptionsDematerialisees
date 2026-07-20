const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { entiteContext } = require('./api/middlewares/entiteContext.middleware');
const { creerMiddlewareSession } = require('./core/auth/session');
const authRoutes = require('./api/routes/auth.routes');
const candidatsRoutes = require('./api/routes/candidats.routes');
const piecesRoutes = require('./api/routes/pieces.routes');
const { FRONTEND_URL } = require('./config/env');

// Fabrique asynchrone (plutôt qu'un export synchrone de `app`) : le middleware de session a
// besoin de la connection string Neon, récupérée depuis Azure Key Vault (voir
// core/auth/session.js), avant de pouvoir être monté — server.js attend creerApp() avant
// d'écouter le port.
async function creerApp() {
  const app = express();

  app.use(helmet());
  // credentials: true impose une origine explicite (jamais "*") — voir FRONTEND_URL dans
  // config/env.js, cohérent avec la résolution d'entité par sous-domaine (entiteContext).
  app.use(cors({ origin: FRONTEND_URL, credentials: true }));
  app.use(express.json());

  app.use(entiteContext);
  // Doit être monté après entiteContext (req.entite) et avant toute route protégée : les
  // middlewares d'authentification (auth.middleware.js) comparent req.session.utilisateur à
  // req.entite pour l'isolation multi-entité.
  app.use(await creerMiddlewareSession());

  app.use('/api/auth', authRoutes);
  app.use('/api/candidats', candidatsRoutes);
  // Protégée par requireAuth + requireRole (voir pieces.routes.js) — non protégée jusqu'à ce
  // correctif, voir CLAUDE.auth-rbac.md pour le détail de l'état précédent.
  app.use('/api/dossiers/:dossierId/pieces', piecesRoutes);

  // Gestionnaire d'erreurs générique : ne jamais renvoyer la stack ni le détail interne au client.
  // eslint-disable-next-line no-unused-vars
  app.use((erreur, req, res, next) => {
    console.error(erreur);
    res.status(500).json({ erreur: 'Une erreur est survenue. Merci de réessayer.' });
  });

  return app;
}

module.exports = { creerApp };
