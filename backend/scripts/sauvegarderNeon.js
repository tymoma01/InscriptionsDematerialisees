// Exécute la sauvegarde quotidienne complète de la base Neon (pg_dump -Fc -> chiffrement
// AES-256-GCM -> upload SharePoint/Backups/neon -> purge des 30 sauvegardes les plus récentes),
// voir core/sauvegarde/sauvegardeService.js et docs/sauvegarde-neon.md pour le détail.
//
// Déclenché quotidiennement par .github/workflows/sauvegarde-neon.yml (GitHub Actions, cron) —
// peut aussi être lancé manuellement en local (nécessite `az login` pour DefaultAzureCredential,
// et le binaire pg_dump dans le PATH).
//
// Usage : node scripts/sauvegarderNeon.js

const { executerSauvegarde } = require('../src/core/sauvegarde/sauvegardeService');

executerSauvegarde()
  .then(() => process.exit(0))
  .catch(() => process.exit(1)); // le détail de l'erreur est déjà loggué par sauvegardeService.js
