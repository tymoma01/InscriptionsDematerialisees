require('dotenv').config();

module.exports = {
  PORT: process.env.PORT ?? 3000,
  // Code entité utilisé quand le sous-domaine ne permet pas de résoudre l'entité
  // (développement local sur localhost) — voir entiteContext.middleware.js.
  ENTITE_PAR_DEFAUT: process.env.ENTITE_PAR_DEFAUT,
  // Origine autorisée pour CORS (voir app.js) — le front est servi sur un sous-domaine par
  // entité en production (accecit.xxx.fr, adaptel.xxx.fr...), à faire évoluer vers une
  // résolution multi-origine par entité le jour où plusieurs entités sont déployées ensemble.
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
};
