# Sauvegarde quotidienne de la base Neon

Complément au PITR natif Neon (limité à 6h de fenêtre sur le plan gratuit, voir CLAUDE.md) : un
`pg_dump` complet, chiffré, envoyé quotidiennement sur SharePoint (`Backups/neon`), avec une
rétention glissante de 30 jours.

## Vue d'ensemble

```
pg_dump (-Fc, compressé)  ->  chiffrement AES-256-GCM  ->  upload SharePoint  ->  purge > 30 dumps
   pgDumpService.js            chiffrementSauvegarde.js      stockageSauvegardeGraph.js
```

Orchestré par `backend/src/core/sauvegarde/sauvegardeService.js`, déclenché quotidiennement par
`.github/workflows/sauvegarde-neon.yml` (GitHub Actions, cron `0 3 * * *` UTC), point d'entrée
`backend/scripts/sauvegarderNeon.js`.

En cas d'échec : log explicite (jamais silencieux) + notification email à
`SAUVEGARDE_EMAIL_ALERTE` via `notificationFactory()` (voir `notificationEchecSauvegarde.js`), et
le job GitHub Actions se termine en échec (visible dans l'onglet Actions / notifications GitHub).

## Secrets à créer avant la première exécution

### Azure Key Vault (`SecretsForInscriptions`)

- `backup-encryption-key` : clé AES-256 encodée en base64 (32 octets une fois décodée), **distincte**
  de `nir-encryption-key`. Génération :
  ```bash
  openssl rand -base64 32
  ```
- Les secrets `graph-client-id` / `graph-client-secret` / `graph-tenant-id` existent déjà (voir
  `graphClient.js`) et sont réutilisés tels quels — aucune permission Graph supplémentaire requise
  (`Files.ReadWrite.All` couvre déjà l'écriture dans `Backups/neon`, un dossier de la même
  bibliothèque `Inscriptions`).

### GitHub Actions (Settings → Secrets and variables → Actions)

- `AZURE_CLIENT_ID` / `AZURE_TENANT_ID` / `AZURE_SUBSCRIPTION_ID` : service principal **dédié** à
  ce job (à créer séparément de tout autre usage), avec un accès Key Vault en lecture seule scopé
  aux seuls secrets nécessaires (`neon-connection-string`, `backup-encryption-key`,
  `graph-client-id`, `graph-client-secret`, `graph-tenant-id`) — ne pas réutiliser une identité à
  plus large portée pour ce job non interactif. Ce service principal doit avoir un **identifiant
  fédéré (federated credential)** configuré côté app registration Azure (Certificates & secrets →
  Federated credentials), scénario "GitHub Actions deploying Azure resources", avec pour subject
  `repo:tymoma01/InscriptionsDematerialisees:ref:refs/heads/main` — **pas de client secret à
  générer/stocker** pour ce service principal.
- `SAUVEGARDE_EMAIL_ALERTE` (secret, pas variable, depuis le 2026-08-20 — l'ancien réglage en
  variable d'environnement Actions ne déclenchait jamais l'envoi de l'email d'alerte) : adresse à
  notifier en cas d'échec.

Le job s'authentifie auprès d'Azure via l'étape `azure/login@v2` du workflow (fédération OIDC : le
jeton d'identité GitHub du job — exposé grâce à `permissions.id-token: write` — est échangé contre
un jeton Azure AD, sans jamais transiter par un client secret). Cette étape ouvre une session Azure
CLI sur le runner ; `DefaultAzureCredential` (voir `keyVaultClient.js`) la retrouve ensuite via son
`AzureCliCredential` de repli, exactement comme un `az login` fait en local — aucun code spécifique
à CI n'a été nécessaire dans `keyVaultClient.js`.

## Format des fichiers de sauvegarde

- Nom : `backup-{AAAA-MM-JJ}.dump.enc` (date Europe/Paris), ex. `backup-2026-08-19.dump.enc`.
- Contenu : `IV (12 octets) || dump pg_dump -Fc chiffré || tag GCM (16 octets)`.
- Emplacement : bibliothèque documentaire `Inscriptions` (même site SharePoint que les pièces
  justificatives candidat), dossier `Backups/neon/`.

## Tester une restauration (à faire réellement, pas supposer que ça marche)

**Ne jamais tester une restauration directement sur la base Neon de production.** Créer d'abord
une base/branche Neon de test dédiée (Neon supporte les branches de base de données — une branche
créée à partir de `main` peut aussi servir de cible de restauration jetable, ou une base Postgres
locale/Docker fait tout aussi bien l'affaire pour ce test).

1. **Lister les sauvegardes disponibles :**
   ```bash
   cd backend
   node scripts/telechargerSauvegardeNeon.js
   ```
2. **Télécharger et déchiffrer une sauvegarde :**
   ```bash
   node scripts/telechargerSauvegardeNeon.js backup-2026-08-19.dump.enc /tmp/restauration
   # -> /tmp/restauration/backup-2026-08-19.dump (dump en clair, prêt pour pg_restore)
   ```
3. **Restaurer vers une base de TEST** (jamais `--neon-prod` à cette étape) :
   ```bash
   node scripts/restaurerSauvegardeNeon.js /tmp/restauration/backup-2026-08-19.dump \
     --connection-string "postgresql://user:motdepasse@host-de-test/dbname?sslmode=require"
   ```
4. Vérifier le contenu restauré (quelques requêtes de contrôle : nombre de lignes par table clé,
   dernière date de création d'un dossier, etc.) avant de considérer le test concluant.
5. **Nettoyer** : supprimer le dump en clair local (`rm -rf /tmp/restauration`) — il contient des
   données candidat sensibles en clair (NIR compris, une fois déchiffré par la base elle-même).

Pour une restauration réelle en production (sinistre avéré, à ne déclencher qu'après validation) :
```bash
node scripts/restaurerSauvegardeNeon.js <chemin_dump> --neon-prod --confirmer
```
`--confirmer` est obligatoire : sans lui, le script refuse de s'exécuter — matérialise qu'il s'agit
d'un geste voulu et pas d'un oubli d'argument. `pg_restore` est appelé avec `--clean --if-exists` :
les objets existants de la base cible sont supprimés puis recréés à partir du dump, ce qui est
**destructif** pour toute donnée entrée après le dump restauré.

## Politique de rétention

Chaque exécution réussie liste les sauvegardes déjà présentes dans `Backups/neon`, trie par date de
création, conserve les 30 plus récentes et supprime le reste (voir
`sauvegardeService.appliquerRetention`). Un échec d'upload n'entraîne aucune purge (la rétention
s'applique seulement après un upload réussi, voir l'ordre des étapes dans `sauvegardeService.js`).

## Dépannage

- **`pg_dump a échoué`** : vérifier la compatibilité de version (`pg_dump --version` doit être
  >= à la version majeure du serveur Postgres de Neon), et que `PGSSLMODE=require` n'est pas
  bloqué par un pare-feu sortant (cas GitHub Actions : peu probable, runners hébergés).
- **`azure/login` échoue (`AADSTS70021` ou équivalent)** : le federated credential de l'app
  registration ne correspond pas au subject envoyé par GitHub — vérifier qu'il cible bien
  `repo:tymoma01/InscriptionsDematerialisees:ref:refs/heads/main` (ou l'environnement utilisé, le
  cas échéant) et que `permissions.id-token: write` est bien présent sur le job dans le workflow.
- **`DefaultAzureCredential` ne trouve toujours aucune méthode d'authentification malgré
  `azure/login`** : vérifier que l'étape `azure/login@v2` s'exécute bien **avant** "Exécuter la
  sauvegarde" dans le workflow (l'ordre des steps fait foi) et qu'elle se termine sans erreur.
- **Authentification Microsoft Graph expirée ou invalide** : vérifier `graph-client-id` /
  `graph-client-secret` / `graph-tenant-id` dans Key Vault (message d'erreur déjà explicite, voir
  `erreursGraph.js`).
- **Le job GitHub Actions échoue sans notification email reçue** : vérifier que
  `SAUVEGARDE_EMAIL_ALERTE` est bien définie **en secret** GitHub Actions (pas en variable — une
  variable ne remonte jamais dans `secrets.*`, voir le mapping dans le workflow) et que le service
  principal a la permission Graph `Mail.Send` déjà accordée pour `graphMailProvider.js` — sinon
  l'échec de notification est loggué dans les logs du job (onglet Actions), qui restent la source
  de vérité en dernier recours (`notifierEchecSauvegarde` n'échoue jamais bruyamment par design,
  voir `notificationEchecSauvegarde.js`).
- **Secret `backup-encryption-key` absent** : `chiffrementSauvegarde.js` échoue explicitement dès
  le premier `chiffrerFichier` avec ce message, avant tout upload.
