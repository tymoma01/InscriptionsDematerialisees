# CLAUDE.md — InscriptionsDematerialisees

## Contexte du projet

ACCECIT est une agence de recrutement et de mise à disposition de personnel (secteurs hôtellerie et tertiaire). Le processus d'inscription des candidats est aujourd'hui entièrement manuel (dossiers papier, planification des tests sur tableur Excel).

Ce projet consiste à développer un outil interne pour digitaliser ce processus : une web-app d'inscription utilisée sur tablette à l'accueil, et un back-office pour recruteurs/formateurs.

**Périmètre : ACCECIT uniquement** (décision du 2026-10-02). Adaptel, initialement envisagée comme seconde entité, est sortie du projet : elle n'utilisera pas cette base, et son code (config `entites/adaptel`, connecteur OVH) a été supprimé. L'architecture modulaire existante (configuration par entité, connecteurs interchangeables) est conservée parce qu'elle structure bien le code, mais la réutilisation par une autre entité n'est plus un objectif : ne pas engager de travail dont la seule justification serait de rendre le moteur générique pour une entité hypothétique. Voir section "Modularité" ci-dessous.

## Besoins issus du terrain (observations)

**Accueil et Coordination** (chargé des inscriptions) : vérifie physiquement les pièces à l'accueil avant toute saisie. L'accueil est engorgé par des candidats aux objectifs hétérogènes.

Besoins identifiés :
- Vue centralisée des dossiers en attente (validation, test, relance)
- Historique des relances par candidat, pour ne pas relancer en double
- Confirmation de présence à un créneau avant le jour J (rappel automatique), pour réduire les désistements
- Motif de désistement enregistré systématiquement, pour objectiver le phénomène et nourrir le futur tableau de bord

**Coordination** : valide les profils, planifie les tests et formations, effectue les relances et reprogrammations. Aucun moyen actuel d'anticiper les désistements — principal point de perte de temps.

**RH (second contrôle)** : besoin de télécharger/exporter les dossiers candidats.

## Modularité — principe d'architecture conservé

Le workflow (étapes, statuts, transitions, blocs de formulaire, critères d'évaluation) reste piloté par la configuration de l'entité plutôt que par du code métier figé : c'est ce qui permet de faire évoluer le parcours ACCECIT sans toucher au moteur. En revanche, les notions propres à ACCECIT (secteurs Hôtellerie/Tertiaire, marques, logos) peuvent être utilisées dans le code sans les extraire en configuration — il n'y a plus de seconde entité à servir.

Principes à respecter :
- Une entité = une configuration (blocs de formulaire actifs, machine à états des statuts, critères d'évaluation du test, intégrations externes activées)
- Les statuts et transitions sont définis en configuration (DB ou fichiers de config versionnés), pas en `switch/case` codé en dur
- Les intégrations externes (SmartOF, SMS/email) sont des modules optionnels, activables par entité
- Le formulaire d'inscription est composé de blocs réutilisables (bloc "infos perso", bloc "coordonnées", etc.) qu'une entité peut activer/désactiver/réordonner
- La résolution de l'entité côté back se fait par **sous-domaine**, portée par un middleware dédié (`entiteContext`), décision validée avec le développeur senior — mécanisme conservé, une seule entité (ACCECIT) servie

## Stack technique

- **Front-end** : React — web-app mobile-first, usage prévu **sur tablette uniquement** (pas d'usage mobile téléphone à prévoir dans les choix d'UI)
  - **Pas de PWA pour l'instant** : web-app classique servie dans le navigateur de la tablette (pas d'installation sur l'appareil). Manifest PWA et Service Worker sont **reportés à plus tard** — ne pas les ajouter tant que ce point n'est pas explicitement redemandé, pour éviter toute ambiguïté sur le périmètre actuel.
- **Back-end** : Node.js
- **Base de données** : **Neon (PostgreSQL managé)**, région `eu-central-1` (Francfort), décision validée avec le développeur senior le 2026-07-16 — remplace le choix initial Azure Database for PostgreSQL. **Point ouvert : vérifier le DPA Neon** pour les catégories de données sensibles (NIR, RIB, pièces d'identité) avant mise en production, au même titre que la résidence UE (déjà confirmée : Francfort)
  - La connection string Neon est stockée dans **Azure Key Vault** (`SecretsForInscriptions`) — jamais en clair dans `.env`, pas de raccourci même en local. Récupération via `backend/src/db/config.js` (`DefaultAzureCredential` : `az login` en local, Managed Identity en prod). **Deux secrets distincts selon `NODE_ENV`** : `neon-connection-string` (prod uniquement) et `neon-connection-string-dev` (tout le reste, dont `npm run dev`) — voir `docs/architecture-technique.md` §6 pour la procédure de vérification avant toute manipulation (incident du 2026-09-04 où les deux ont été confondus : **le nom du secret et le volume de données ne suffisent pas** à distinguer laquelle est la vraie prod, toujours vérifier via la révision Container Apps active).
- **Stockage documents** : **Azure OneDrive/SharePoint** via Microsoft Graph, derrière l'interface commune `StorageConnector` (upload/download/suppression), sélectionnée par `storageFactory` — aucun module métier n'appelle l'API de stockage directement.
- **Authentification** : sessions serveur (voir section dédiée)
- **Notifications SMS** : **AllMySMS** (compte déjà existant) — à intégrer via ce prestataire. **Notifications email** : **Microsoft Graph** (`inscriptions@accecit.com`, même app registration que le stockage OneDrive/SharePoint), décision du 2026-08-05 qui corrige le choix initial AllMySMS pour l'email ci-dessus — vérification faite auprès de leur documentation officielle : AllMySMS ne propose pas d'envoi d'email réel (leur seul service proche, Mail2SMS, fait l'inverse). Détails : `docs/architecture-technique.md` §3.3.
- **Linter** : ESLint
- **Versioning** : Git / GitHub — dépôt privé `tymoma01/InscriptionsDematerialisees`
- **Éditeur** : VS Code

## Authentification et rôles

Authentification par **session serveur** (pas de JWT) :
- `express-session` + `connect-pg-simple` comme store persistant (Neon PostgreSQL)
- Hash des mots de passe avec `argon2` (ou `bcrypt`)
- Cookie `httpOnly`, `secure`, `sameSite=strict`
- Session courte (ex: 2h d'inactivité) vu la sensibilité des données (NIR, RIB, pièces d'identité)
- Rate limiting sur `/login` (ex: `express-rate-limit`)
- Logging des connexions/déconnexions, intégré à la traçabilité RGPD

**Rôles (RBAC, table `roles` plutôt que des booléens) :**
- **Accueil / Coordination** : saisie, vérification des pièces, planification des tests, relances, reprogrammations, **export groupé (ZIP) des pièces justificatives d'un candidat** (voir Recruteur ci-dessous pour l'historique de cette capacité)
- **Recruteur** : back-office complet, validation des profils, décision finale (validé/refusé), **export groupé (ZIP) des pièces justificatives d'un candidat** (besoin RH "second contrôle", décision du 2026-07-31 — corrige une attribution erronée précédente de cette capacité au rôle Formateur ci-dessous ; étendue à Accueil/Coordination et Admin le 2026-08-17, toujours exclue de Formateur/Inspecteur, qui n'ont qu'une consultation en lecture seule des pièces)
- **Formateur** : reçoit les notifications de test, évalue les candidats, valide/invalide le test
- **Admin** : gestion globale, configuration de l'entité (workflow, blocs de formulaire), **export groupé (ZIP) des pièces justificatives d'un candidat** (voir Recruteur ci-dessus)

HTTPS recommandé même en usage intranet local (reverse proxy avec certificat, même auto-signé).

## Parcours fonctionnel cible (configuration ACCECIT)

1. **Inscription** — le candidat s'inscrit sur une tablette à l'accueil (web-app, format tablette uniquement)
2. **Formulaire d'inscription** — 5 blocs :
   - Informations personnelles (nom, naissance, n° SS, situation familiale)
   - Coordonnées (adresse, téléphone, email, contact d'urgence)
   - Situation professionnelle (n° France Travail, disponibilités, langues, poste, CV)
   - Provenance et préférence (comment connu, poste souhaité : bureau ou hôtel)
   - Consentements RGPD + **signature électronique** — c'est à cette étape précise que le candidat accepte explicitement le stockage du NIR et des autres données sensibles (voir section dédiée "Signature électronique de la charte" ci-dessous)
3. **Prise de pièces justificatives par l'accueil** — après la signature, la personne de l'accueil prend en photo (via la tablette) : pièce d'identité, carte vitale/NIR, RIB, justificatif de domicile
4. **Questions de vérification** — quelques questions posées par l'accueil pour valider l'expérience/le profil déclaré
5. **Back-office recruteur** — filtres, indicateur de complétude, demande de complément, commentaires
6. **Envoi en test** — attribution selon poste et disponibilité, date fixée, **notification envoyée au formateur concerné**
7. **Test** — évalué selon des critères définis (hygiène, assiduité, respect des consignes, temps moyens de service, etc.)
   - **Validé** → le candidat passe en formation
   - **Invalidé** (non productif ou autre motif) → motif enregistré ; possibilité de refus définitif ou de nouvelle tentative selon décision
8. **Absence au test** — si le candidat ne se présente pas, reprogrammation possible (nouveau RDV) avec motif d'absence enregistré. Le workflow doit permettre de reprogrammer un test autant de fois que nécessaire, avec historique conservé.
9. **Formation** — une fois le test validé, appel à l'**API SmartOF** pour créer directement le profil du candidat côté formation (intégration à documenter séparément : endpoint, auth, mapping des champs candidat → SmartOF)
10. **Fin de formation** — une invitation est envoyée au candidat pour venir signer son contrat et récupérer sa tenue
11. **Tableau de bord** — indicateurs de pilotage et filtres, alimenté par les statuts et les motifs (désistement, invalidation) collectés tout au long du parcours

## Statuts du dossier candidat (configuration ACCECIT)

```
Nouveau
  → En attente de documents
  → Complet
  → En cours d'étude
  → Envoyé en test
  → [Absent au test] → reprogrammé → Envoyé en test (boucle)
  → Test validé → En formation (création profil SmartOF)
  → Test invalidé → Refusé (motif) OU reprogrammé (boucle vers Envoyé en test, selon décision)
  → Formation terminée → Invité signature contrat
  → Sous contrat (tenue récupérée) / Refusé (motif)
```

Cette machine à états est définie en configuration, pas en dur (voir section Modularité).

## Signature électronique de la charte — décision technique (2026-07-16)

Au bloc 5 du formulaire d'inscription (Consentements RGPD + signature), le candidat doit :
1. Faire défiler l'intégralité du texte de la charte avant que le bouton de signature ne soit activable (scroll-gate)
2. Signer au doigt sur la tablette (capture via canvas)

**Scroll-gate (lecture forcée) :**
- Le conteneur de texte de la charte écoute son scroll ; le bouton "Signer" reste désactivé tant que `scrollTop + clientHeight < scrollHeight` (avec une marge de tolérance de quelques px)
- Cas à gérer : si la charte tient déjà entièrement dans la hauteur du conteneur (pas de scroll possible), le bouton doit être débloqué automatiquement (sinon blocage permanent)
- À tester sur les dimensions réelles de la tablette de production, pas seulement en desktop

**Capture de signature :**
- Lib `signature_pad` (gère nativement le tactile, export en PNG base64 via `toDataURL()`)
- Vérifier `pad.isEmpty()` avant validation pour éviter une signature vide

**Preuve légale associée à la signature — ne jamais faire confiance au client :**
- Le front envoie au back uniquement : `candidat_id`, `charte_hash` (SHA-256 du texte exact de la charte affichée), `signature_image` — **jamais de timestamp généré côté client**
- Le back **recalcule le hash côté serveur** à partir du texte de la charte active et vérifie qu'il correspond à `charte_hash` reçu, avant d'insérer — empêche qu'un client signe un texte différent de celui réellement affiché
- L'horodatage de preuve est celui du serveur au moment de l'insertion en base : colonne `created_at timestamptz NOT NULL DEFAULT now()` dans Neon — le back ignore volontairement tout champ timestamp qu'un client enverrait

**Modèle de données — décision (2026-07-16) : tout dans Neon, avec versionnement de la charte**

Le texte de la charte est versionné en base (table `chartes`), pour pouvoir retrouver le texte exact correspondant à un hash donné a posteriori. La signature référence la charte par FK, pas seulement par hash.

```sql
CREATE TABLE chartes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  texte text NOT NULL,
  hash text NOT NULL UNIQUE, -- SHA-256 précalculé à l'insertion
  entite_id uuid NOT NULL REFERENCES entites(id), -- une charte par entité (modularité)
  date_creation timestamptz NOT NULL DEFAULT now(),
  actif boolean NOT NULL DEFAULT true
);

CREATE TABLE signatures_charte (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidat_id uuid NOT NULL REFERENCES candidats(id),
  charte_id uuid NOT NULL REFERENCES chartes(id), -- FK directe vers la version signée
  signature_image bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- **`signatures_charte` et `chartes` vivent dans Neon**, pas dans OneDrive/SharePoint : ce ne sont pas des pièces justificatives scannées par un tiers, mais des données structurées générées par l'app elle-même (hash + petite image de tracé), cohérentes avec le reste des données candidat déjà en base (dont le NIR chiffré)
- Ne pas confondre avec le flux des pièces justificatives (CNI/RIB/attestations), qui reste inchangé : celui-ci continue de passer par OneDrive/SharePoint, Neon ne gardant qu'une référence
- `charte_id` en FK plutôt qu'un simple hash stocké : jointure directe, plus robuste qu'un hash seul si l'algo de hash ou la normalisation du texte change un jour

**Points ouverts restants (à trancher avant implémentation) :**
- Qui peut désactiver/remplacer une charte active ? Pressenti : rôle **Admin** uniquement, cohérent avec le reste du modèle de permissions
- Le changement de version de charte doit-il lui-même être tracé (qui a modifié, quand) ? Probablement oui, cohérent avec l'exigence de traçabilité RGPD déjà en place ailleurs dans le projet — à formaliser dans une table d'audit ou en réutilisant le mécanisme de logging déjà prévu pour les connexions

**Hors périmètre pour l'instant (à ne pas implémenter sans redemande explicite) :**
- Horodatage qualifié RFC 3161 (type Universign) — niveau de preuve renforcé mais disproportionné au volume actuel (~3 000 signatures/an)

## Intégrations externes

- **API SmartOF** : appelée à la validation du test pour créer le profil candidat côté formation. SmartOF reste le SI de référence pour la gestion des formations ; ce projet ne le remplace pas, il s'y articule. Module à isoler proprement (pas de dépendance dure dans le cœur du moteur de workflow, pour rester compatible avec une entité qui n'utiliserait pas SmartOF).
- **SMS : AllMySMS** — compte déjà existant, à réutiliser plutôt que d'ouvrir un nouveau prestataire. **Email : Microsoft Graph** (`inscriptions@accecit.com`, décision du 2026-08-05 — AllMySMS ne propose pas d'envoi d'email réel, voir plus haut). Cas d'usage (les deux canaux, sélectionnés par `notificationFactory()`) : convocation, relance, confirmation de créneau, notification formateur, invitation signature de contrat.
- **Stockage documents** : Azure OneDrive/SharePoint, derrière l'interface commune `StorageConnector` (upload/download/suppression/liste), connecteur sélectionné par la configuration de l'entité (`storageFactory`).

## Contraintes RGPD (structurantes)

Le dossier contient des données sensibles : numéro de sécurité sociale (NIR), pièce d'identité, RIB.

- Le NIR est saisi directement par le candidat dans le formulaire ; le consentement à son stockage est recueilli explicitement au moment de la signature électronique (pas de consentement implicite)
- Consentement explicite du candidat à chaque étape sensible
- Droit de modification et de suppression des données
- Conservation limitée à 1 an pour les candidats non retenus
- Base de données hébergée sur **Neon (PostgreSQL managé, région eu-central-1 Francfort)** ; documents stockés sur **Azure OneDrive/SharePoint** — DPA Neon **à vérifier avant mise en production** (résidence UE déjà confirmée), pour ces catégories de données sensibles (NIR, pièce d'identité, RIB)
- **Architecture de stockage des données sensibles — figée le 2026-07-16** (détails techniques : `docs/architecture-technique.md` §1.7) :
  - **NIR** : reste dans Neon, mais jamais en clair — chiffrement applicatif **AES-256-GCM** avant écriture en base, clé dans **Azure Key Vault** (jamais dans le code ni en variable d'environnement en clair), déchiffrement à la volée côté serveur uniquement (jamais côté client), implémenté en couche réutilisable (`nirCipher.js`), pas ad hoc à chaque usage.
  - **Pièces justificatives** (scan CNI, RIB, attestations) : jamais dans Neon — stockées sur **OneDrive/SharePoint via Microsoft Graph API**, Neon ne garde qu'une référence (id/URL/métadonnée). Raison : le DPA Microsoft 365 est déjà en place et vérifié pour ACCECIT, contrairement au DPA Neon dont le statut (entité contractante Neon vs Databricks, plan payant requis) est encore en cours de clarification — pas de nouveau sous-traitant non stabilisé pour des fichiers qui ont déjà une voie conforme.
  - **Signature électronique de la charte** (hash + image de tracé) : reste dans Neon également — voir section dédiée ci-dessus. Ce n'est pas une pièce justificative externe, donc pas soumise à la même logique de routage vers OneDrive.
- Accès différencié par rôle (accueil/coordination, recruteur, formateur, admin)
- Traçabilité complète des actions effectuées sur un dossier (qui, quoi, quand)
- HTTPS recommandé même sur réseau local, vu la nature des données transitant (NIR, RIB, pièces d'identité)

## Conventions de code

- Code et commentaires en français (noms de variables métier : `candidat`, `dossier`, `pieceJustificative`, `entite`, `workflow`...)
- Commits en français, messages descriptifs
- Respect des règles ESLint du projet (`npm run lint` dans `backend/` et `frontend/`) ; tests : `npm test` dans les deux (node:test au back, Vitest au front)
- Le parcours (statuts, transitions, blocs) reste en configuration plutôt qu'en dur (voir Modularité)

**Droits par rôle — source unique : `backend/src/core/auth/permissions.js`**
- Matrice « permission → rôles ». Les routes la vérifient avec `requirePermission('cle')` ; le front reçoit avec la session la liste des clés accordées (`utilisateur.permissions`) et teste `peut(utilisateur, 'cle')` (`frontend/src/core/auth/permissions.js`)
- Ajouter un rôle ou modifier un droit = modifier ce seul fichier (+ la ligne de la table `roles`). Ne jamais réintroduire de liste de rôles dans une route ou un composant
- Comparer un `roleCode` directement n'est admis que pour désigner l'espace propre d'un rôle (ex. pages Formateur/Inspecteur), jamais pour décider d'un droit

**Configuration en base**
- La base est la source de vérité de la configuration (statuts, transitions, blocs du formulaire, types de pièces, questionnaires, chartes, motifs, lieux). Le front la lit via l'API, jamais via une copie statique
- Toute modification d'une valeur de configuration passe par une **migration** (appliquée automatiquement au démarrage), jamais par un script de seed : les seeds ne servent qu'à amorcer une base vide et ne sont pas rejoués au déploiement
- Au démarrage, le serveur signale dans les logs toute table de configuration vide pour une entité active (`core/configuration/verificationConfiguration.js`)

**Référentiels partagés (front)** : libellés et listes réutilisés par plusieurs écrans (postes, statuts…) vivent dans `frontend/src/core/referentiels/`, jamais recopiés dans chaque page.

**Commentaires** : expliquer le *pourquoi* actuel, pas l'historique. Pas de date, de « audit du … » ni de « demande utilisateur » dans le code : l'historique va dans le message de commit. Un commentaire qui décrit un ancien comportement est à supprimer.