const http = require('http');
const app = require('./app');
const { PORT } = require('./config/env');

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
