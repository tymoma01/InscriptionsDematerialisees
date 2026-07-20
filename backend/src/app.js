const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { entiteContext } = require('./api/middlewares/entiteContext.middleware');
const candidatsRoutes = require('./api/routes/candidats.routes');
const piecesRoutes = require('./api/routes/pieces.routes');
const { FRONTEND_URL } = require('./config/env');

const app = express();

app.use(helmet());
// credentials: true impose une origine explicite (jamais "*") — voir FRONTEND_URL dans
// config/env.js, cohérent avec la résolution d'entité par sous-domaine (entiteContext).
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

app.use(entiteContext);

app.use('/api/candidats', candidatsRoutes);
// TODO(auth) : à protéger par une route RBAC (rôles Accueil/Coordination, Recruteur, Formateur —
// voir CLAUDE.md) une fois auth.middleware.js/rbac.middleware.js implémentés ; non protégée à ce
// jour, comme le reste de l'API (voir pieces.routes.js pour le détail du point ouvert).
app.use('/api/dossiers/:dossierId/pieces', piecesRoutes);

// Gestionnaire d'erreurs générique : ne jamais renvoyer la stack ni le détail interne au client.
// eslint-disable-next-line no-unused-vars
app.use((erreur, req, res, next) => {
  console.error(erreur);
  res.status(500).json({ erreur: 'Une erreur est survenue. Merci de réessayer.' });
});

module.exports = app;
