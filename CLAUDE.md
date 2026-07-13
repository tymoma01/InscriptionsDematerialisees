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

## Stack technique

- **Front-end** : React — web-app mobile-first, usage prévu **sur tablette uniquement** (pas d'usage mobile téléphone à prévoir dans les choix d'UI)
- **Back-end** : Node.js
- **Base de données** : serveur local (à héberger en interne — pas de cloud)
- **Stockage documents** : cloud, **spécifique à chaque entité** (voir section Modularité) :
  - ACCECIT → Azure OneDrive
  - Adaptel → OVH
  - Le connecteur de stockage doit être un module interchangeable (interface commune upload/download/suppression), pas un appel direct codé en dur à une API de stockage donnée. On développe et teste d'abord avec ACCECIT (Azure OneDrive), mais l'abstraction doit permettre de brancher OVH pour Adaptel sans toucher au reste du code.
- **Authentification** : sessions serveur (voir section dédiée)
- **Notifications SMS/email** : **AllMySMS** (compte déjà existant) — à intégrer via ce prestataire
- **Linter** : ESLint
- **Versioning** : Git / GitHub — dépôt privé `tymoma01/InscriptionsDematerialisees`
- **Éditeur** : VS Code

## Authentification et rôles

Authentification par **session serveur** (pas de JWT) :
- `express-session` + store persistant adapté à la DB locale (ex: `connect-pg-simple` si PostgreSQL)
- Hash des mots de passe avec `argon2` (ou `bcrypt`)
- Cookie `httpOnly`, `secure`, `sameSite=strict`
- Session courte (ex: 2h d'inactivité) vu la sensibilité des données (NIR, RIB, pièces d'identité)
- Rate limiting sur `/login` (ex: `express-rate-limit`)
- Logging des connexions/déconnexions, intégré à la traçabilité RGPD

**Rôles (RBAC, table `roles` plutôt que des booléens) :**
- **Accueil / Coordination** : saisie, vérification des pièces, planification des tests, relances, reprogrammations
- **Recruteur** : back-office complet, validation des profils, décision finale (validé/refusé)
- **Formateur** : reçoit les notifications de test, évalue les candidats, valide/invalide le test, **exporte les dossiers**
- **Admin** : gestion globale, configuration de l'entité (workflow, blocs de formulaire)

HTTPS recommandé même en usage intranet local (reverse proxy avec certificat, même auto-signé).

## Parcours fonctionnel cible (configuration ACCECIT)

1. **Inscription** — le candidat s'inscrit sur une tablette à l'accueil (web-app, format tablette uniquement)
2. **Formulaire d'inscription** — 5 blocs :
   - Informations personnelles (nom, naissance, n° SS, situation familiale)
   - Coordonnées (adresse, téléphone, email, contact d'urgence)
   - Situation professionnelle (n° France Travail, disponibilités, langues, poste, CV)
   - Provenance et préférence (comment connu, poste souhaité : bureau ou hôtel)
   - Consentements RGPD + **signature électronique** — c'est à cette étape précise que le candidat accepte explicitement le stockage du NIR et des autres données sensibles
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

## Intégrations externes

- **API SmartOF** : appelée à la validation du test pour créer le profil candidat côté formation. SmartOF reste le SI de référence pour la gestion des formations ; ce projet ne le remplace pas, il s'y articule. Module à isoler proprement (pas de dépendance dure dans le cœur du moteur de workflow, pour rester compatible avec une entité qui n'utiliserait pas SmartOF).
- **SMS / Email : AllMySMS** — compte déjà existant, à réutiliser plutôt que d'ouvrir un nouveau prestataire. Cas d'usage : convocation, relance, confirmation de créneau, notification formateur, invitation signature de contrat.
- **Stockage documents** : module de connecteur par entité (Azure OneDrive pour ACCECIT, OVH pour Adaptel). Interface commune à définir (upload/download/suppression/liste), implémentations séparées par prestataire, sélection du connecteur pilotée par la configuration de l'entité.

## Contraintes RGPD (structurantes)

Le dossier contient des données sensibles : numéro de sécurité sociale (NIR), pièce d'identité, RIB.

- Le NIR est saisi directement par le candidat dans le formulaire ; le consentement à son stockage est recueilli explicitement au moment de la signature électronique (pas de consentement implicite)
- Consentement explicite du candidat à chaque étape sensible
- Droit de modification et de suppression des données
- Conservation limitée à 1 an pour les candidats non retenus
- Base de données hébergée **localement** ; documents stockés en **cloud dédié à l'entité** (Azure OneDrive pour ACCECIT, OVH pour Adaptel) — vérifier les conditions de résidence des données et les garanties de sécurité de chaque prestataire pour ces catégories de données sensibles (NIR, pièce d'identité, RIB)
- Accès différencié par rôle (accueil/coordination, recruteur, formateur, admin)
- Traçabilité complète des actions effectuées sur un dossier (qui, quoi, quand)
- HTTPS recommandé même sur réseau local, vu la nature des données transitant (NIR, RIB, pièces d'identité)

## Conventions de code

- Code et commentaires en français (noms de variables métier : `candidat`, `dossier`, `pieceJustificative`, `entite`, `workflow`...)
- Commits en français, messages descriptifs
- Respect des règles ESLint du projet
- Toute logique spécifique à ACCECIT doit être isolée de la logique générique du moteur (voir Modularité)