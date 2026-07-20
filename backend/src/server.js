const http = require('http');
const { creerApp } = require('./app');
const { PORT } = require('./config/env');

// creerApp() est asynchrone (attend la connection string Neon depuis Azure Key Vault pour
// monter le middleware de session, voir core/auth/session.js) — le serveur n'écoute qu'une fois
// l'app entièrement construite.
async function demarrer() {
  const app = await creerApp();
  const serveur = http.createServer(app);

  serveur.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
  });

  // Arrêt propre : on attend la fin des requêtes en cours avant de quitter
  process.on('SIGTERM', () => {
    serveur.close(() => {
      console.log('Serveur arrêté proprement.');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    serveur.close(() => {
      console.log('Serveur arrêté proprement.');
      process.exit(0);
    });
  });
}

demarrer().catch((erreur) => {
  console.error('Échec du démarrage du serveur ✘');
  console.error(erreur);
  process.exit(1);
});
