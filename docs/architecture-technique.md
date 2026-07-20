# Architecture technique globale — InscriptionsDematerialisees

**Statut** : document de cadrage, à faire relire par le développeur senior avant implémentation détaillée.

**Sources** : `CLAUDE.md` (contraintes produit et modularité), `docs/schema-bdd-proposition.md` (schéma validé, 23 tables), arborescence existante de `backend/` et `frontend/` (squelette de dossiers/fichiers déjà créé, pour l'instant vide ou stub — ce document en explicite le rôle prévu).

Ce document répond à trois questions structurantes de CLAUDE.md :
1. Comment le **moteur générique** se sépare de la **configuration par entité** ?
2. Comment les **connecteurs de stockage** (Azure OneDrive / OVH) sont-ils abstraits ?
3. Comment les **intégrations SmartOF et AllMySMS** sont-elles isolées du cœur du moteur ?

---

## 1. Séparation moteur générique / configuration par entité

### 1.1 Principe

CLAUDE.md l'énonce comme contrainte n°1 du projet : *"Ne pas coder le parcours ACCECIT en dur [...] doit être piloté par une configuration propre à chaque entité, pas par du code métier figé."*

Concrètement, deux zones de code ne se mélangent jamais :

| Zone | Contenu | Emplacement |
|---|---|---|
| **Moteur générique** | Logique valable pour n'importe quelle entité : machine à états, rendu de formulaire par blocs, moteur d'évaluation, RBAC, audit | `backend/src/core/**`, `frontend/src/core/**` |
| **Configuration par entité** | Données propres à ACCECIT ou Adaptel : statuts, transitions, blocs actifs, critères d'évaluation, thème visuel | `backend/src/entites/<code_entite>/*.config.json`, tables `entites`, `statuts`, `transitions_statut`, `motifs`, `entite_blocs_formulaire`, `criteres_evaluation` (schéma validé) ; `frontend/src/entites/<code_entite>/theme.js` |

Le test de CLAUDE.md — *"est-ce générique (va dans le moteur) ou spécifique à cette entité (va dans sa config) ?"* — se traduit en une règle simple : si l'ajout nécessite d'insérer une ligne dans une table `entite_id`-scopée ou une clé dans un fichier `*.config.json`, c'est de la configuration ; si l'ajout nécessite de modifier un fichier sous `core/`, il doit rester valable pour toute entité, faute de quoi la contrainte de modularité est rompue.

### 1.2 Résolution de l'entité (middleware `entiteContext`)

Décision déjà actée avec le développeur senior : la résolution se fait par sous-domaine (`accecit.xxx.fr`, `adaptel.xxx.fr`). Le fichier `backend/src/api/middlewares/entiteContext.middleware.js` (actuellement un stub) est le point d'entrée unique de cette résolution :

- extrait le sous-domaine de `req.hostname`,
- charge la ligne correspondante de la table `entites` (code, connecteur_stockage, sms_actif, smartof_actif, durée de conservation),
- attache le résultat à `req.entite`,
- s'exécute **avant** toute route métier, de sorte qu'aucun contrôleur n'a besoin de reconnaître explicitement ACCECIT ou Adaptel — il consulte `req.entite`.

Tout code qui aurait besoin de savoir "est-ce ACCECIT ?" en dur dans `core/` est un signal que la contrainte de modularité est violée ; ce genre de branchement doit être remplacé par une lecture de configuration (`req.entite.smartof_actif`, `req.entite.connecteur_stockage`, etc.).

### 1.3 Moteur de workflow configurable

Le cœur du moteur (`backend/src/core/workflow/workflowEngine.js`, avec `workflowConfig.schema.js` pour la validation de forme) ne connaît aucun statut ni transition nommés en dur. Il lit :

- `statuts` (table, scoped par `entite_id`) : liste des statuts possibles, avec `est_initial`/`est_final`,
- `transitions_statut` + `transition_roles` : quelles transitions sont permises, depuis quel statut, vers quel statut, par quel rôle, avec ou sans motif obligatoire,
- `motifs` : vocabulaire des motifs (désistement, absence, invalidation, refus), propre à chaque entité.

La machine à états ACCECIT décrite dans CLAUDE.md (Nouveau → ... → Sous contrat/Refusé, avec boucles de reprogrammation) devient un jeu de lignes en base pour `entite_id = accecit`, pas un `switch/case`. `backend/src/entites/accecit/workflow.config.json` sert de source pour le seed initial de ces lignes (script d'amorçage, pas logique applicative) ; le moteur lui-même ne lit que la base.

Chaque transition exécutée est journalisée dans `historique_statuts` (append-only), qui synchronise `dossiers.statut_id` via le trigger `sync_dossier_statut` (voir migration `010_creation_table_historique_statuts.js`) — le moteur écrit dans `historique_statuts`, jamais directement dans `dossiers.statut_id`.

### 1.4 Formulaire modulaire par blocs

Même principe côté formulaire :

- `backend/src/core/formulaire/blocRegistry.js` : catalogue des types de blocs que le moteur sait afficher/valider (correspond à la table `blocs_disponibles`) — ajouter un bloc réellement nouveau reste du code (composant React + entrée de registre), mais l'**activation, l'ordre et la configuration** d'un bloc pour une entité donnée sont pilotés par `entite_blocs_formulaire` (colonne `config` en JSONB : champs obligatoires, libellés surchargés).
- `backend/src/core/formulaire/blocValidator.js` : validation générique (zod) pilotée par la config du bloc, pas par des règles ACCECIT figées.
- Les données saisies vont dans `dossier_donnees_formulaire` (JSONB par bloc), à l'exception du NIR qui reste en colonnes dédiées et chiffrées dans `candidats` (voir §1.6) — c'est la seule donnée sensible qui sort volontairement du schéma générique JSONB, car elle est universelle à toute entité et nécessite un traitement cryptographique spécifique.
- Côté front, `frontend/src/core/formulaire/BlocRenderer.jsx` consomme la config active de l'entité pour composer dynamiquement le formulaire ; `frontend/src/core/formulaire/blocs/Bloc*.jsx` sont les composants génériques par type de bloc (infos perso, coordonnées, situation pro, provenance, consentement).

### 1.5 Évaluation du test

`backend/src/core/evaluation/evaluationEngine.js` lit `criteres_evaluation` (scoped par entité) pour construire dynamiquement la grille d'évaluation présentée au formateur (`frontend/src/pages/formateur/Evaluation.jsx`). Les critères ACCECIT (hygiène, assiduité, respect des consignes, temps de service) n'apparaissent dans aucun fichier de code — uniquement en lignes de table, comme les statuts.

### 1.6 Ce qui reste volontairement hors configuration

Trois éléments restent communs à toutes les entités par décision déjà actée (`docs/schema-bdd-proposition.md`, "Décisions déjà actées") et ne sont donc pas configurables :
- la table `roles` (RBAC) : les 4 rôles (accueil/coordination, recruteur, formateur, admin) sont conceptuellement identiques d'une entité à l'autre,
- le chiffrement applicatif du NIR (colonnes `nir`/`nir_iv` sur `candidats`) : traitement universel, pas une variation métier,
- le rattachement d'un candidat à une seule entité (pas de profil partagé entre ACCECIT et Adaptel).

### 1.7 Architecture de stockage des données sensibles — décision figée (2026-07-16)

Le NIR est un identifiant réglementé qui exige une protection renforcée ; les pièces justificatives (CNI, RIB, attestations) sont des fichiers déjà couverts par le DPA Microsoft 365 en place. Ces deux catégories de données sensibles suivent donc des chemins de stockage différents, chacun choisi pour sa raison propre plutôt que par défaut :

**NIR — reste dans Neon, mais jamais en clair.**
- Chiffrement symétrique **AES-256-GCM**, appliqué côté application (Node.js) avant toute écriture en base — jamais de NIR en clair transmis à Postgres.
- La clé de chiffrement vit dans **Azure Key Vault** — jamais dans le code, jamais dans une variable d'environnement en clair (voir [[decision-nir-keyvault]]).
- Colonnes `nir` (texte chiffré) + `nir_iv` (IV/nonce nécessaire au déchiffrement) sur `candidats` — aucune des deux ne permet de reconstituer le NIR sans passer par la clé Key Vault.
- Le déchiffrement n'a lieu **qu'à la volée, côté serveur**, pour les usages qui le nécessitent explicitement (ex. transmission à SmartOF) — jamais côté client/frontend, jamais persisté en clair ailleurs (logs, cache, exports).
- Implémentation en **couche réutilisable** : `backend/src/core/securite/nirCipher.js` (chiffrer/déchiffrer) — aucun module métier ne doit réimplémenter AES-256-GCM ad hoc ; tout accès au NIR passe par ce service.

**Pièces justificatives — jamais dans Neon, uniquement une référence.**
- Le fichier binaire (scan CNI, RIB, attestations) est stocké sur **OneDrive/SharePoint via Microsoft Graph API** (`azureOneDriveConnector.js`, §2), jamais en base.
- Neon ne conserve qu'une **référence** (id de fichier / URL / métadonnée) dans `pieces_justificatives.reference_stockage` — cohérent avec l'interface `StorageConnector` déjà décrite en §2.
- **Pourquoi pas Neon pour ces fichiers aussi** : Microsoft 365 (OneDrive/SharePoint) a un DPA déjà en place et vérifié pour ACCECIT, alors que le statut du DPA Neon (DPA GDPR existant, mais entité contractante Neon vs Databricks à clarifier, et protections contractuelles réservées au plan payant "Scale" — voir [[decision-neon-db]]) est encore en cours de clarification. Ne pas ajouter un nouveau sous-traitant non stabilisé pour des fichiers qui ont déjà une voie de stockage conforme.

---

## 2. Abstraction des connecteurs de stockage documentaire

### 2.1 Interface commune

CLAUDE.md est explicite : *"Le connecteur de stockage doit être un module interchangeable (interface commune upload/download/suppression), pas un appel direct codé en dur à une API de stockage donnée."*

`backend/src/integrations/stockage/StorageConnector.js` définit ce contrat, indépendant de tout prestataire :

```
upload(dossierId, fichier)     → reference_stockage
download(referenceStockage)    → flux/buffer du fichier
supprimer(referenceStockage)   → void
lister(dossierId)              → liste de references_stockage
```

Chaque implémentation concrète respecte cette signature :
- `azureOneDriveConnector.js` — implémentation ACCECIT, via `@microsoft/microsoft-graph-client` + `@azure/identity` (déjà en dépendances du backend),
- `ovhConnector.js` — implémentation Adaptel, via l'API S3-compatible d'OVH (`@aws-sdk/client-s3`, déjà en dépendance ; le choix S3-compatible vs API native OVH reste à trancher, cf. `.env.example`).

### 2.2 Sélection par entité (`storageFactory.js`)

`backend/src/integrations/stockage/storageFactory.js` est le seul point du code qui choisit une implémentation concrète, à partir de `req.entite.connecteur_stockage` (colonne `entites.connecteur_stockage`, valeurs `'azure_onedrive'` | `'ovh'` selon le schéma validé) :

```
storageFactory(codeConnecteur) → instance conforme à StorageConnector
```

Aucun autre module du moteur n'importe `azureOneDriveConnector` ou `ovhConnector` directement — tout passe par `storageFactory`, qui retourne un objet respectant l'interface commune. Ainsi, brancher un troisième prestataire pour une future entité ne touche que ce dossier `integrations/stockage/` : une nouvelle classe + une nouvelle valeur possible de `connecteur_stockage`.

### 2.3 Ce qui traverse la frontière

Seule la référence renvoyée par le connecteur (`reference_stockage`, `nom_fichier`) est persistée en base, dans `pieces_justificatives` — jamais le contenu binaire du fichier (cohérent avec *"documents stockés en cloud dédié à l'entité"*, hors du périmètre de la base PostgreSQL).

---

## 3. Isolation des intégrations SmartOF et AllMySMS

### 3.1 Principe commun

CLAUDE.md est précis sur les deux intégrations : elles doivent être des **modules optionnels, activables par entité**, sans dépendance dure dans le cœur du moteur — une entité qui n'utilise ni l'un ni l'autre doit pouvoir fonctionner sans que le moteur "sache" qu'ils existent.

Le mécanisme d'activation est le même pour les deux : un booléen sur `entites` (`smartof_actif`, `sms_actif`), lu au moment où le moteur de workflow ou de relance a besoin de déclencher l'intégration. Le moteur appelle une interface, jamais directement le SDK/l'API du prestataire.

### 3.2 SmartOF

- `backend/src/integrations/smartof/smartOfClient.js` : appel HTTP à l'API SmartOF (endpoint, authentification — détails à documenter séparément, comme prévu par CLAUDE.md).
- `backend/src/integrations/smartof/smartOfMapper.js` : traduit les champs internes (`candidats`, `dossiers`, `dossier_donnees_formulaire`) vers le format attendu par SmartOF — c'est la seule couche qui connaît à la fois le modèle interne et le modèle SmartOF, pour que ni l'un ni l'autre ne "fuite" dans le reste du code.
- Déclenchement : à la validation du test (transition de workflow vers le statut équivalent à "Test validé"), le moteur constate `req.entite.smartof_actif === true` et invoque le client — sans quoi il ne fait rien. Le résultat (succès/échec, id candidat côté SmartOF) est journalisé dans `smartof_sync`, hors du cœur du moteur (schéma validé, §9) : une entité sans SmartOF n'a simplement aucune ligne dans cette table.
- SmartOF reste le SI de référence pour la gestion des formations : ce projet ne duplique pas cette donnée, il transmet et journalise l'appel.

### 3.3 AllMySMS

- `backend/src/integrations/notifications/NotificationProvider.js` : interface commune (`envoyer(destinataire, canal, message)`), sur le même principe que `StorageConnector` — pensée pour qu'un futur changement de prestataire SMS/email ne modifie qu'un fichier.
- `backend/src/integrations/notifications/allMySmsProvider.js` : unique implémentation actuelle, réutilisant le compte AllMySMS déjà existant (pas de nouveau prestataire ouvert, conformément à CLAUDE.md).
- Cas d'usage déclenchés par le moteur ou par la coordination (convocation, relance, confirmation de créneau, notification formateur à l'étape "Envoi en test", invitation signature de contrat) : chaque envoi est journalisé dans `relances` (canal, utilisateur à l'origine, résultat) — ce qui répond directement au besoin terrain *"historique des relances par candidat, pour ne pas relancer en double"*.
- Comme pour SmartOF, l'activation est conditionnée à `req.entite.sms_actif` ; si `false`, le moteur n'invoque jamais `allMySmsProvider`.

### 3.4 Pourquoi cette isolation compte pour la réutilisabilité

Les deux intégrations vivent exclusivement sous `backend/src/integrations/`, jamais sous `backend/src/core/`. Un `grep` de "smartof" ou "allmysms" dans `core/` doit renvoyer zéro résultat : c'est le test de non-régression le plus simple pour vérifier que l'isolation n'a pas été rompue au fil du développement.

---

## 4. Schéma en un coup d'œil : qui pilote quoi

| Ce qui varie par entité | Table(s) / fichier(s) | Ce qui reste fixe (moteur) |
|---|---|---|
| Statuts et transitions | `statuts`, `transitions_statut`, `transition_roles`, `workflow.config.json` (seed) | `workflowEngine.js` |
| Motifs (désistement, absence, invalidation, refus) | `motifs` | Contrainte `motif_requis` sur les transitions |
| Blocs de formulaire actifs/ordre/config | `entite_blocs_formulaire`, `formulaire.config.json` (seed) | `blocRegistry.js`, `blocValidator.js`, `BlocRenderer.jsx` |
| Critères d'évaluation | `criteres_evaluation`, `evaluation.config.json` (seed) | `evaluationEngine.js` |
| Pièces justificatives exigées | `types_pieces` | `pieces_justificatives` |
| Connecteur de stockage | `entites.connecteur_stockage` | `StorageConnector.js` (interface), `storageFactory.js` (sélection) |
| Activation SmartOF | `entites.smartof_actif` | `smartOfClient.js`, `smartOfMapper.js` |
| Activation SMS/email | `entites.sms_actif` | `NotificationProvider.js`, `allMySmsProvider.js` |
| Durée de conservation RGPD | `entites.duree_conservation_mois` | Job de purge (à implémenter, hors périmètre de ce document) |
| Thème visuel | `frontend/src/entites/<code>/theme.js` | Composants génériques `core/` |

Cette table est le résumé opérationnel de la contrainte de modularité de CLAUDE.md : toute nouvelle entité (une troisième après ACCECIT et Adaptel) doit pouvoir être onboardée en remplissant la colonne de gauche, sans toucher à la colonne de droite.

---

## Prochaines étapes techniques (suite à la décision § 1.7)

1. **Service de chiffrement NIR** : créer `backend/src/core/securite/nirCipher.js` (AES-256-GCM, fonctions `chiffrer(nirClair)` / `dechiffrer(nirChiffre, iv)`), remplaçant la logique ad hoc actuellement absente — aucun autre module ne doit accéder au NIR sans passer par ce service.
2. **Clé de chiffrement dans Azure Key Vault** : créer le secret (nom à définir, ex. `nir-encryption-key`), configurer l'accès applicatif (Managed Identity en prod, `az login`/`DefaultAzureCredential` en local) — bloqué en attente des accès Azure (cf. [[decision-nir-keyvault]]).
3. **Fondations de l'intégration Graph API** : compléter `backend/src/integrations/stockage/azureOneDriveConnector.js` (actuellement stub) pour l'upload/download/suppression réels via `@microsoft/microsoft-graph-client` + `@azure/identity` ; vérifier l'auth (app registration, permissions Graph `Files.ReadWrite` scopées au dossier ACCECIT).

## Points laissés ouverts (hors périmètre de ce document)

- Mapping détaillé des champs SmartOF (endpoint, auth, structure du payload) — à documenter séparément comme prévu par CLAUDE.md.
- Choix S3-compatible vs API native pour le connecteur OVH (`.env.example` note ce point comme non tranché).
~~Emplacement et rotation de la clé de chiffrement du NIR~~ — **tranché le 2026-07-16** : Azure Key Vault retenu (accès en attente côté équipe, cf. point ouvert n°4 de `docs/schema-bdd-proposition.md`).
- Job de purge RGPD (candidats non retenus, `duree_conservation_mois`) — non implémenté à ce stade.
- Authentification par session et RBAC (design déjà décrit par CLAUDE.md, mais `auth.middleware.js`/`rbac.middleware.js`/`core/auth/*` toujours vides — toutes les routes API actuelles sont donc non protégées) : voir point ouvert n°5 de `docs/schema-bdd-proposition.md` pour le détail et les questions restant à trancher.
