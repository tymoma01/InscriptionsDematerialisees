require('dotenv').config();

module.exports = {
  PORT: process.env.PORT ?? 3000,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  // Code entité utilisé quand le sous-domaine ne permet pas de résoudre l'entité
  // (développement local sur localhost) — voir entiteContext.middleware.js.
  ENTITE_PAR_DEFAUT: process.env.ENTITE_PAR_DEFAUT,
  // Origine autorisée pour CORS (voir app.js) — le front est servi sur un sous-domaine par
  // entité en production (accecit.xxx.fr, adaptel.xxx.fr...), à faire évoluer vers une
  // résolution multi-origine par entité le jour où plusieurs entités sont déployées ensemble.
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  // Secret de signature des cookies de session (express-session, voir core/auth/session.js).
  // Reste en variable d'environnement plutôt qu'Azure Key Vault, contrairement à la connection
  // string Neon et à la clé NIR : express-session en a besoin de façon synchrone au démarrage, et
  // sa compromission n'expose que l'intégrité/l'authenticité des cookies (pas de donnée métier
  // directement) — à revalider avec le développeur senior (voir CLAUDE.auth-rbac.md).
  SESSION_SECRET: process.env.SESSION_SECRET,
  // Compte AllMySMS déjà existant (voir CLAUDE.md, intégrations externes) — reste en variable
  // d'environnement classique comme dans .env.example, pas Azure Key Vault : ce n'est pas une
  // donnée candidat sensible (NIR, connection string DB), contrairement aux secrets qui y sont
  // déjà (voir core/securite/keyVaultClient.js pour ceux-là).
  ALLMYSMS_API_LOGIN: process.env.ALLMYSMS_API_LOGIN,
  ALLMYSMS_API_PASSWORD: process.env.ALLMYSMS_API_PASSWORD,
  // Adresse alertée en cas d'échec de la sauvegarde quotidienne Neon (voir
  // core/sauvegarde/notificationEchecSauvegarde.js et docs/sauvegarde-neon.md) — reste en variable
  // d'environnement classique, même logique que les identifiants AllMySMS ci-dessus (pas une
  // donnée candidat sensible).
  SAUVEGARDE_EMAIL_ALERTE: process.env.SAUVEGARDE_EMAIL_ALERTE,
};
