require('dotenv').config();

module.exports = {
  PORT: process.env.PORT ?? 3000,
  // Code entité utilisé quand le sous-domaine ne permet pas de résoudre l'entité
  // (développement local sur localhost) — voir entiteContext.middleware.js.
  ENTITE_PAR_DEFAUT: process.env.ENTITE_PAR_DEFAUT,
};
