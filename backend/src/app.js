const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { entiteContext } = require('./api/middlewares/entiteContext.middleware');
const candidatsRoutes = require('./api/routes/candidats.routes');

const app = express();

app.use(helmet());
app.use(cors({ credentials: true }));
app.use(express.json());

app.use(entiteContext);

app.use('/api/candidats', candidatsRoutes);

// Gestionnaire d'erreurs générique : ne jamais renvoyer la stack ni le détail interne au client.
// eslint-disable-next-line no-unused-vars
app.use((erreur, req, res, next) => {
  console.error(erreur);
  res.status(500).json({ erreur: 'Une erreur est survenue. Merci de réessayer.' });
});

module.exports = app;
