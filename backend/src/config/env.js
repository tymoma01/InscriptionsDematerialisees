require('dotenv').config();

module.exports = {
  PORT: process.env.PORT ?? 3000,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  // Code entité utilisé quand le sous-domaine ne permet pas de résoudre l'entité
  // (développement local sur localhost) — voir entiteContext.middleware.js.
  ENTITE_PAR_DEFAUT: process.env.ENTITE_PAR_DEFAUT,
  // Liste de hostnames complets (domaine personnalisé, ex. "inscriptions.accecit.com") à
  // traiter comme "utiliser ENTITE_PAR_DEFAUT" au même titre que localhost/www/hostname
  // mono-label — voir entiteContext.middleware.js. Nécessaire car cette instance ne sert
  // actuellement qu'une seule entité (ACCECIT) sur un domaine personnalisé dont le premier
  // label ("inscriptions") n'est ni un code d'entité réel ni un des cas de repli existants
  // (une éventuelle 2e entité sera un clone séparé du déploiement, pas du multi-tenant ici).
  HOTES_ENTITE_PAR_DEFAUT: (process.env.HOTES_ENTITE_PAR_DEFAUT ?? '')
    .split(',')
    .map((hote) => hote.trim())
    .filter(Boolean),
  // Origine autorisée pour CORS (voir app.js) — le front est servi sur un sous-domaine par
  // entité en production (accecit.xxx.fr, adaptel.xxx.fr...), à faire évoluer vers une
  // résolution multi-origine par entité le jour où plusieurs entités sont déployées ensemble.
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:5173',
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
  // Démarrage des crons in-process (node-cron, voir jobs/rappelCron.js et consorts) — utile
  // uniquement en dev local, pour ne pas avoir à lancer les scripts à la main. Désactivé par
  // défaut en production (NODE_ENV=production) : le déclenchement en prod passe par des Azure
  // Container Apps Jobs externes (voir scripts/executer*ToutesEntites.js), pas par le process web
  // lui-même — décision utilisateur, 2026-08-31 (l'hébergement cible, Container Apps plan
  // Consumption, scale-to-zero/scale-out, ce qui rend un cron in-process avec verrou en mémoire
  // non fiable). Peut être forcé explicitement dans un sens ou l'autre via la variable d'env.
  ACTIVER_CRONS_INTERNES:
    process.env.ACTIVER_CRONS_INTERNES != null
      ? process.env.ACTIVER_CRONS_INTERNES === 'true'
      : (process.env.NODE_ENV ?? 'development') !== 'production',
};
