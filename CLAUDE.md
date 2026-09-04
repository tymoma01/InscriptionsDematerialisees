# CLAUDE.md — InscriptionsDematerialisees

## Contexte du projet

ACCECIT est une agence de recrutement et de mise à disposition de personnel (secteurs hôtellerie et tertiaire). Le processus d'inscription des candidats est aujourd'hui entièrement manuel (dossiers papier, planification des tests sur tableur Excel).

Ce projet consiste à développer un outil interne pour digitaliser ce processus : une web-app d'inscription utilisée sur tablette à l'accueil, et un back-office pour recruteurs/formateurs.

**Contrainte structurante : l'outil doit être conçu pour être réutilisé par une autre entité avec un processus différent.** Le besoin d'inscription dématérialisée est le même, mais les étapes du parcours, les statuts, les blocs de formulaire et les critères d'évaluation varient d'une entité à l'autre. Voir section "Modularité" ci-dessous — c'est la contrainte la plus importante du projet et elle doit guider tous les choix d'architecture.

## Besoins issus du terrain (observations)

**Accueil et Coordination** (chargé des inscriptions) : vérifie physiquement les pièces à l'accueil avant toute saisie. L'accueil est engorgé par des candidats aux objectifs hétérogènes.

Besoins identifiés :
- Vue centralisée des dossiers en attente (validation, test, relance)
- Historique des relances par candidat, pour ne pas relancer en double
- Confirmation de présence à un créneau avant le jour J (rappel automatique), pour réduire les désistements
- Motif de désistement enregistré systématiquement, pour objectiver le phénomène et nourrir le futur tableau de bord

**Coordination** : valide les profils, planifie les tests et formations, effectue les relances et reprogrammations. Aucun moyen actuel d'anticiper les désistements — principal point de perte de temps.

**RH (second contrôle)** : besoin de télécharger/exporter les dossiers candidats.

## Modularité — contrainte d'architecture

Ne pas coder le parcours ACCECIT en dur. Le workflow (étapes, statuts, transitions, blocs de formulaire, critères d'évaluation) doit être piloté par une configuration propre à chaque entité, pas par du code métier figé.

Principes à respecter :
- Une entité = une configuration (blocs de formulaire actifs, machine à états des statuts, critères d'évaluation du test, intégrations externes activées)
- Les statuts et transitions sont définis en configuration (DB ou fichiers de config versionnés), pas en `switch/case` codé en dur
- Les intégrations externes (SmartOF, SMS/email) sont des modules optionnels, activables par entité
- Le formulaire d'inscription est composé de blocs réutilisables (bloc "infos perso", bloc "coordonnées", etc.) qu'une entité peut activer/désactiver/réordonner
- Avant d'implémenter une étape spécifique à ACCECIT, se demander : "est-ce générique (va dans le moteur) ou spécifique à cette entité (va dans sa config) ?"
- La résolution de l'entité côté back se fait par **sous-domaine** (ex: `accecit.xxx.fr`, `adaptel.xxx.fr`), portée par un middleware dédié (`entiteContext`), décision validée avec le développeur senior

## Stack technique

- **Front-end** : React — web-app mobile-first, usage prévu **sur tablette uniquement** (pas d'usage mobile téléphone à prévoir dans les choix d'UI)
  - **Pas de PWA pour l'instant** : web-app classique servie dans le navigateur de la tablette (pas d'installation sur l'appareil). Manifest PWA et Service Worker sont **reportés à plus tard** — ne pas les ajouter tant que ce point n'est pas explicitement redemandé, pour éviter toute ambiguïté sur le périmètre actuel.
- **Back-end** : Node.js
- **Base de données** : **Neon (PostgreSQL managé)**, région `eu-central-1` (Francfort), décision validée avec le développeur senior le 2026-07-16 — remplace le choix initial Azure Database for PostgreSQL. **Point ouvert : vérifier le DPA Neon** pour les catégories de données sensibles (NIR, RIB, pièces d'identité) avant mise en production, au même titre que la résidence UE (déjà confirmée : Francfort)
  - La connection string Neon est stockée dans **Azure Key Vault** (`SecretsForInscriptions`) — jamais en clair dans `.env`, pas de raccourci même en local. Récupération via `backend/src/db/config.js` (`DefaultAzureCredential` : `az login` en local, Managed Identity en prod). **Deux secrets distincts selon `NODE_ENV`** : `neon-connection-string` (prod uniquement) et `neon-connection-string-dev` (tout le reste, dont `npm run dev`) — voir `docs/architecture-technique.md` §6 pour la procédure de vérification avant toute manipulation (incident du 2026-09-04 où les deux ont été confondus : **le nom du secret et le volume de données ne suffisent pas** à distinguer laquelle est la vraie prod, toujours vérifier via la révision Container Apps active).
- **Stockage documents** : cloud, **spécifique à chaque entité** (voir section Modularité) :
  - ACCECIT → Azure OneDrive
  - Adaptel → OVH
  - Le connecteur de stockage doit être un module interchangeable (interface commune upload/download/suppression), pas un appel direct codé en dur à une API de stockage donnée. On développe et teste d'abord avec ACCECIT (Azure OneDrive), mais l'abstraction doit permettre de brancher OVH pour Adaptel sans toucher au reste du code.
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

Cette machine à états est spécifique à ACCECIT et doit être définie en configuration, pas en dur (voir section Modularité) — une autre entité aura potentiellement moins ou plus d'étapes.

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
- Ne pas confondre avec le flux des pièces justificatives (CNI/RIB/attestations), qui reste inchangé : celui-ci continue de passer par OneDrive (ACCECIT) / OVH (Adaptel), Neon ne gardant qu'une référence
- `charte_id` en FK plutôt qu'un simple hash stocké : jointure directe, plus robuste qu'un hash seul si l'algo de hash ou la normalisation du texte change un jour

**Points ouverts restants (à trancher avant implémentation) :**
- Qui peut désactiver/remplacer une charte active ? Pressenti : rôle **Admin** uniquement, cohérent avec le reste du modèle de permissions
- Le changement de version de charte doit-il lui-même être tracé (qui a modifié, quand) ? Probablement oui, cohérent avec l'exigence de traçabilité RGPD déjà en place ailleurs dans le projet — à formaliser dans une table d'audit ou en réutilisant le mécanisme de logging déjà prévu pour les connexions

**Hors périmètre pour l'instant (à ne pas implémenter sans redemande explicite) :**
- Horodatage qualifié RFC 3161 (type Universign) — niveau de preuve renforcé mais disproportionné au volume actuel (~3 000 signatures/an)

## Intégrations externes

- **API SmartOF** : appelée à la validation du test pour créer le profil candidat côté formation. SmartOF reste le SI de référence pour la gestion des formations ; ce projet ne le remplace pas, il s'y articule. Module à isoler proprement (pas de dépendance dure dans le cœur du moteur de workflow, pour rester compatible avec une entité qui n'utiliserait pas SmartOF).
- **SMS : AllMySMS** — compte déjà existant, à réutiliser plutôt que d'ouvrir un nouveau prestataire. **Email : Microsoft Graph** (`inscriptions@accecit.com`, décision du 2026-08-05 — AllMySMS ne propose pas d'envoi d'email réel, voir plus haut). Cas d'usage (les deux canaux, sélectionnés par `notificationFactory()`) : convocation, relance, confirmation de créneau, notification formateur, invitation signature de contrat.
- **Stockage documents** : module de connecteur par entité (Azure OneDrive pour ACCECIT, OVH pour Adaptel). Interface commune à définir (upload/download/suppression/liste), implémentations séparées par prestataire, sélection du connecteur pilotée par la configuration de l'entité.

## Contraintes RGPD (structurantes)

Le dossier contient des données sensibles : numéro de sécurité sociale (NIR), pièce d'identité, RIB.

- Le NIR est saisi directement par le candidat dans le formulaire ; le consentement à son stockage est recueilli explicitement au moment de la signature électronique (pas de consentement implicite)
- Consentement explicite du candidat à chaque étape sensible
- Droit de modification et de suppression des données
- Conservation limitée à 1 an pour les candidats non retenus
- Base de données hébergée sur **Neon (PostgreSQL managé, région eu-central-1 Francfort)** ; documents stockés en **cloud dédié à l'entité** (Azure OneDrive pour ACCECIT, OVH pour Adaptel) — DPA Neon **à vérifier avant mise en production** (résidence UE déjà confirmée), de même que le DPA de chaque prestataire de stockage documentaire, pour ces catégories de données sensibles (NIR, pièce d'identité, RIB)
- **Architecture de stockage des données sensibles — figée le 2026-07-16** (détails techniques : `docs/architecture-technique.md` §1.7) :
  - **NIR** : reste dans Neon, mais jamais en clair — chiffrement applicatif **AES-256-GCM** avant écriture en base, clé dans **Azure Key Vault** (jamais dans le code ni en variable d'environnement en clair), déchiffrement à la volée côté serveur uniquement (jamais côté client), implémenté en couche réutilisable (`nirCipher.js`), pas ad hoc à chaque usage.
  - **Pièces justificatives** (scan CNI, RIB, attestations) : jamais dans Neon — stockées sur **OneDrive/SharePoint via Microsoft Graph API**, Neon ne garde qu'une référence (id/URL/métadonnée). Raison : le DPA Microsoft 365 est déjà en place et vérifié pour ACCECIT, contrairement au DPA Neon dont le statut (entité contractante Neon vs Databricks, plan payant requis) est encore en cours de clarification — pas de nouveau sous-traitant non stabilisé pour des fichiers qui ont déjà une voie conforme.
  - **Signature électronique de la charte** (hash + image de tracé) : reste dans Neon également — voir section dédiée ci-dessus. Ce n'est pas une pièce justificative externe, donc pas soumise à la même logique de routage vers OneDrive/OVH.
- Accès différencié par rôle (accueil/coordination, recruteur, formateur, admin)
- Traçabilité complète des actions effectuées sur un dossier (qui, quoi, quand)
- HTTPS recommandé même sur réseau local, vu la nature des données transitant (NIR, RIB, pièces d'identité)

## Conventions de code

- Code et commentaires en français (noms de variables métier : `candidat`, `dossier`, `pieceJustificative`, `entite`, `workflow`...)
- Commits en français, messages descriptifs
- Respect des règles ESLint du projet
- Toute logique spécifique à ACCECIT doit être isolée de la logique générique du moteur (voir Modularité)