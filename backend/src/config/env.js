require('dotenv').config();

module.exports = {
  // 3001 par défaut en local (3000 déjà pris par nginx sur cette machine) — voir Dockerfile
  // pour la valeur de prod (ENV PORT, surchargée indépendamment de ce défaut).
  PORT: process.env.PORT ?? 3001,
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
  // Démarrage des crons in-process (node-cron, voir jobs/rappelCron.js et consorts). Décision
  // utilisateur, 2026-09-07 : REVIENT sur le choix du 2026-08-31 (Azure Container Apps Jobs
  // externes) — motif coût, l'agent voulant que ces jobs ne consomment que pendant que l'app
  // elle-même tourne, pas indépendamment sur des ressources Azure séparées. Le souci de fiabilité
  // qui avait motivé le passage aux ACA Jobs (Container Apps plan Consumption, scale-to-zero/
  // scale-out) reste réel en théorie, mais `inscriptions-backend` a par ailleurs déjà une règle de
  // scale KEDA cron ("horaires-bureau", scale.rules côté Azure, hors dépôt) qui force 1 replica de
  // 8h à 20h heure de Paris tous les jours — fenêtre qui couvre largement les 3 horaires métier
  // (rappels 9h/13h30/17h, bascule/sync toutes les heures) : le cron in-process peut donc compter
  // sur une instance déjà debout à ces horaires, sans avoir à passer l'app en permanence allumée
  // (minReplicas: 1 24/7), ce qui aurait coûté largement plus cher que les 3 petits Jobs Azure
  // retirés. En dehors de cette fenêtre (nuit, avant 8h/après 20h), l'app peut retomber à 0
  // replica : un rappel/une bascule dont l'horaire tomberait hors fenêtre ne se déclencherait pas
  // avant le prochain réveil de l'app — accepté, aucun des 3 horaires métier actuels ne tombe hors
  // de cette plage. Forcé explicitement à `true` sur le Container App (variable d'env, pas le
  // défaut ci-dessous) plutôt que de compter sur NODE_ENV : rend l'intention explicite, visible
  // dans la config Azure sans avoir à relire ce fichier.
  ACTIVER_CRONS_INTERNES:
    process.env.ACTIVER_CRONS_INTERNES != null
      ? process.env.ACTIVER_CRONS_INTERNES === 'true'
      : (process.env.NODE_ENV ?? 'development') !== 'production',
};
