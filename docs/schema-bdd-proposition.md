# Proposition de schéma de base de données — PostgreSQL

**Statut** : en attente de relecture avec le développeur senior. Aucune migration SQL n'a été créée à partir de ce document — il sert uniquement de support de revue.

**Date** : 2026-07-13

## Contexte

Ce schéma découle directement des contraintes de `CLAUDE.md`, en particulier la section Modularité :
> Ne pas coder le parcours ACCECIT en dur. Le workflow (étapes, statuts, transitions, blocs de formulaire, critères d'évaluation) doit être piloté par une configuration propre à chaque entité, pas par du code métier figé.

Concrètement : aucune table ne contient de statut, de bloc de formulaire ou de critère d'évaluation codé en dur pour ACCECIT. Tout ce qui varie d'une entité à l'autre est modélisé comme donnée de configuration rattachée à `entites`, pas comme structure de table.

Le schéma compte **23 tables**, réparties en 9 groupes fonctionnels.

Décisions déjà actées avec le développeur senior (à ne plus rediscuter) :
- un `candidat` est rattaché à une seule entité, identifié par un `id` unique (serial) — pas de profil partagé entre ACCECIT et Adaptel
- la table `roles` reste globale (pas de `entite_id`)
- le NIR est chiffré côté applicatif (pas `pgcrypto`), voir table `candidats`

4 points restent ouverts et sont détaillés en fin de document.

---

## 1. Socle multi-entités

### `entites`
```
id                      serial PK
code                    varchar unique   -- 'accecit', 'adaptel' — utilisé par le middleware entiteContext (sous-domaine)
nom                     varchar
connecteur_stockage     varchar          -- 'azure_onedrive' | 'ovh' — pilote storageFactory.js
sms_actif               boolean
smartof_actif           boolean
duree_conservation_mois int default 12   -- RGPD "candidats non retenus", configurable par entité
actif                   boolean
date_creation           timestamptz
```
**Justification** : table pivot de toute la modularité. Chaque ligne = une entité (ACCECIT, Adaptel, une future entité). `connecteur_stockage` et `smartof_actif` traduisent directement les principes "les intégrations externes sont des modules optionnels, activables par entité" et "le connecteur de stockage doit être interchangeable". `duree_conservation_mois` généralise la contrainte RGPD "1 an pour les non-retenus" — une autre entité peut avoir une autre durée légale.

### `roles`
```
id       serial PK
code     varchar unique   -- 'accueil_coordination', 'recruteur', 'formateur', 'admin'
libelle  varchar
```
**Justification** : CLAUDE.md l'exige explicitement — *"table `roles` plutôt que des booléens"*. Reste générique et non lié à une entité, car les 4 rôles décrits sont conceptuellement les mêmes d'une entité à l'autre.

### `utilisateurs`
```
id                  serial PK
entite_id           FK entites
role_id             FK roles
nom, prenom         varchar
email               varchar unique
mot_de_passe_hash   varchar   -- argon2
actif               boolean
derniere_connexion  timestamptz
date_creation       timestamptz
```
**Justification** : un utilisateur (recruteur, formateur...) appartient à une seule entité — cohérent avec la résolution par sous-domaine déjà actée. Le hash argon2 et la RBAC via `role_id` répondent directement à la section Authentification de CLAUDE.md.

---

## 2. Moteur de workflow configurable

### `statuts`
```
id           serial PK
entite_id    FK entites
code         varchar        -- 'nouveau', 'en_attente_documents', 'envoye_test'...
libelle      varchar
ordre        int
est_initial  boolean
est_final    boolean
UNIQUE(entite_id, code)
```
**Justification** : remplace tout `switch/case` en dur. La machine à états ACCECIT du CLAUDE.md (Nouveau → ... → Sous contrat/Refusé) devient un jeu de lignes pour `entite_id = accecit`. Une entité avec un parcours plus court insère simplement moins de lignes — zéro code à modifier.

### `transitions_statut`
```
id                     serial PK
entite_id              FK entites
statut_origine_id      FK statuts (nullable si transition depuis la création du dossier)
statut_destination_id  FK statuts
code_action            varchar     -- 'envoyer_en_test', 'valider_test', 'reprogrammer'...
motif_requis           boolean
```
**Justification** : encode les flèches du diagramme d'états, y compris les boucles ("Absent au test → reprogrammé → Envoyé en test"). `motif_requis` porte l'exigence CLAUDE.md que le motif de désistement/absence/invalidation soit *"enregistré systématiquement"* — le moteur peut bloquer une transition si le motif manque, sans connaître à l'avance la liste des motifs.

### `transition_roles`
```
transition_id  FK transitions_statut
role_id        FK roles
PK (transition_id, role_id)
```
**Justification** : qui a le droit d'exécuter quelle transition (ex : seul un formateur valide/invalide un test) — table de jointure plutôt qu'un champ codé en dur, cohérent avec l'usage de `roles` en table.

### `motifs`
```
id         serial PK
entite_id  FK entites
categorie  varchar   -- 'desistement', 'absence', 'invalidation', 'refus'
code       varchar
libelle    varchar
actif      boolean
```
**Justification** : les motifs sont propres à chaque entité (le vocabulaire d'un désistement chez ACCECIT peut différer chez Adaptel). Alimente directement le futur tableau de bord *"pour objectiver le phénomène"*.

---

## 3. Candidat et dossier

### `candidats`
```
id                  serial PK
entite_id           FK entites
nom, prenom         varchar
date_naissance      date
nir                 bytea       -- ciphertext produit par l'app (ex: AES-256-GCM)
nir_iv              bytea       -- vecteur d'initialisation, propre à chaque chiffrement
situation_familiale varchar
date_creation       timestamptz
```
**Justification** : regroupe les champs universels et sensibles communs à toute entité (identité, NIR). Le NIR est chiffré côté applicatif — deux colonnes (`nir` + `nir_iv`) plutôt qu'un blob concaténé, pour ne pas avoir à parser ciphertext + IV + tag d'authentification à chaque déchiffrement.

### `dossiers`
```
id             serial PK
candidat_id    FK candidats
entite_id      FK entites          -- dénormalisé depuis candidats, simplifie les jointures vers statuts/transitions
statut_id      FK statuts          -- statut courant (dénormalisation volontaire, voir point ouvert n°2)
date_creation  timestamptz
date_maj       timestamptz
```
**Justification** : `statut_id` dupliquant le dernier `historique_statuts` est un choix pragmatique — répond au besoin explicite *"vue centralisée des dossiers en attente"* (filtrer par statut sans recalculer l'historique à chaque requête). Voir point ouvert n°2 pour la discussion du risque de divergence.

### `historique_statuts`
```
id              serial PK
dossier_id      FK dossiers
statut_id       FK statuts
utilisateur_id  FK utilisateurs
motif_id        FK motifs (nullable)
commentaire     text
date_changement timestamptz
```
**Justification** : journal append-only. C'est ce qui permet *"reprogrammer un test autant de fois que nécessaire, avec historique conservé"* — pas de limite de boucle, chaque reprogrammation est une ligne de plus, jamais un écrasement.

---

## 4. Formulaire modulaire (blocs)

### `blocs_disponibles`
```
id      serial PK
code    varchar unique   -- 'infos_perso', 'coordonnees', 'situation_pro', 'provenance', 'consentement'
libelle varchar
```
**Justification** : catalogue global des types de blocs que le moteur front (`BlocRenderer.jsx`) sait afficher. Ajouter un bloc réellement nouveau demande toujours du code (un composant React) — cette table sert à la cohérence référentielle et à l'admin, pas à générer un bloc à partir de rien.

### `entite_blocs_formulaire`
```
id         serial PK
entite_id  FK entites
bloc_code  FK blocs_disponibles
actif      boolean
ordre      int
config     jsonb   -- champs obligatoires, libellés surchargés, etc.
UNIQUE(entite_id, bloc_code)
```
**Justification** : traduit directement *"qu'une entité peut activer/désactiver/réordonner"*. Adaptel peut désactiver le bloc "provenance" ou changer l'ordre sans toucher au code.

### `dossier_donnees_formulaire`
```
id          serial PK
dossier_id  FK dossiers
bloc_code   FK blocs_disponibles
donnees     jsonb
date_maj    timestamptz
UNIQUE(dossier_id, bloc_code)
```
**Justification** : les champs à l'intérieur d'un bloc varient d'une entité à l'autre (ex : "poste souhaité : bureau ou hôtel" est propre à ACCECIT). Le JSONB absorbe cette variabilité sans migration à chaque nouvelle entité — seul le NIR (universel et sensible) sort de ce schéma pour rester dans `candidats` en colonnes dédiées et chiffrées. Voir point ouvert n°3 pour la discussion du compromis.

---

## 5. Pièces justificatives

### `types_pieces`
```
id          serial PK
entite_id   FK entites
code        varchar    -- 'identite', 'carte_vitale', 'rib', 'justificatif_domicile'
libelle     varchar
obligatoire boolean
```
**Justification** : la liste (identité, carte vitale, RIB, justificatif domicile) est celle d'ACCECIT — une autre entité peut exiger d'autres pièces, donc catalogue par entité plutôt qu'énumération fixe.

### `pieces_justificatives`
```
id                 serial PK
dossier_id         FK dossiers
type_piece_id      FK types_pieces
reference_stockage varchar   -- id/chemin retourné par StorageConnector (OneDrive ou OVH)
nom_fichier        varchar
uploaded_by        FK utilisateurs
date_upload        timestamptz
```
**Justification** : ne stocke jamais le fichier lui-même en base (conforme à *"documents stockés en cloud dédié à l'entité"*) — seulement la référence renvoyée par le connecteur de stockage actif, cohérent avec l'abstraction `StorageConnector`.

---

## 6. Consentement RGPD

### `consentements`
```
id                  serial PK
dossier_id          FK dossiers
type_consentement   varchar   -- 'stockage_nir', 'rgpd_general'
accepte             boolean
signature_reference varchar   -- référence vers la signature électronique stockée
date_consentement   timestamptz
```
**Justification** : CLAUDE.md est précis — *"le consentement à son stockage est recueilli explicitement au moment de la signature électronique (pas de consentement implicite)"*. Une ligne dédiée, horodatée, séparée du reste du formulaire, donne une preuve traçable indépendante en cas de contrôle.

---

## 7. Relances et rendez-vous

### `relances`
```
id             serial PK
dossier_id     FK dossiers
canal          varchar   -- 'sms', 'email', 'appel'
utilisateur_id FK utilisateurs
date_envoi     timestamptz
resultat       varchar
```
**Justification** : répond directement au besoin *"historique des relances par candidat, pour ne pas relancer en double"*.

### `rendezvous`
```
id           serial PK
dossier_id   FK dossiers
type_rdv     varchar    -- 'test', 'formation', 'signature_contrat'
date_heure   timestamptz
formateur_id FK utilisateurs (nullable)
statut       varchar    -- 'prevu', 'confirme', 'absent', 'annule'
```
**Justification** : porte la *"confirmation de présence avant le jour J"* et le *"rappel automatique"* (via AllMySMS), ainsi que la notification au formateur à l'étape "Envoi en test".

---

## 8. Évaluation du test

### `criteres_evaluation`
```
id         serial PK
entite_id  FK entites
code       varchar    -- 'hygiene', 'assiduite', 'respect_consignes', 'temps_service'
libelle    varchar
ordre      int
```
**Justification** : les critères cités (hygiène, assiduité, respect des consignes, temps moyens de service) sont propres à ACCECIT — configurables par entité comme les statuts et les blocs.

### `evaluations`
```
id              serial PK
dossier_id      FK dossiers
rendezvous_id   FK rendezvous
formateur_id    FK utilisateurs
resultat_global varchar   -- 'valide', 'invalide'
commentaire     text
date_evaluation timestamptz
```
**Justification** : trace la décision globale du formateur sur un passage de test donné, liée au rendez-vous correspondant.

### `evaluation_resultats`
```
id            serial PK
evaluation_id FK evaluations
critere_id    FK criteres_evaluation
valeur        varchar
```
**Justification** : normalisé plutôt qu'en JSONB pour que le futur tableau de bord puisse agréger par critère (moyennes, taux d'invalidation par motif) sans parser du JSON à chaque requête.

---

## 9. Intégration et traçabilité

### `smartof_sync`
```
id                  serial PK
dossier_id          FK dossiers
smartof_candidat_id varchar
statut_sync         varchar
payload_envoye      jsonb
date_sync           timestamptz
```
**Justification** : isole l'état de synchronisation SmartOF hors du cœur du moteur — une entité sans SmartOF n'a simplement aucune ligne ici, sans dépendance dure ailleurs dans le schéma.

### `journal_audit`
```
id             serial PK
utilisateur_id FK utilisateurs (nullable)
entite_id      FK entites
action         varchar
table_cible    varchar
cible_id       integer
donnees        jsonb
date_action    timestamptz
adresse_ip     varchar
```
**Justification** : répond à *"traçabilité complète des actions effectuées sur un dossier (qui, quoi, quand)"*, exigée dans la section RGPD de CLAUDE.md.

**Note** : la table `session` nécessaire à `connect-pg-simple` sera créée automatiquement par la librairie — elle n'est pas modélisée ici.

---

## Points ouverts à trancher avec le développeur senior

### 1. Découpage en 23 tables (granularité du schéma)
**Contexte** : le schéma sépare finement les responsabilités (workflow, formulaire, pièces, évaluation...) plutôt que de regrouper dans des tables plus généralistes.

- **Option actuelle** : granularité fine, une table par concept métier distinct — meilleure intégrité référentielle (FK, contraintes), requêtes SQL simples pour le tableau de bord, mais plus de jointures et plus de migrations à maintenir.
- **Option alternative** : fusionner certaines tables satellites (ex : `transition_roles` intégrée à `transitions_statut` via un tableau de rôles, ou `evaluation_resultats` intégrée à `evaluations` via JSONB) — moins de tables, mais perte de contraintes FK natives et d'agrégation SQL directe.

**Question pour la revue** : le nombre de tables (23) est-il acceptable pour la maintenance à long terme, ou faut-il en fusionner certaines pour limiter la complexité ?

### 2. Dénormalisation de `dossiers.statut_id`
**Contexte** : `dossiers.statut_id` duplique une information déjà disponible dans `historique_statuts` (sa dernière ligne).

- **Avantage** : lecture rapide du statut courant sans sous-requête, indispensable pour la *"vue centralisée des dossiers en attente"*.
- **Risque** : divergence possible entre `dossiers.statut_id` et le dernier `historique_statuts` si une écriture échoue à mi-chemin (bug applicatif, absence de transaction).
- **Mitigations envisageables** : écrire les deux dans la même transaction SQL côté applicatif, ou un trigger PostgreSQL qui met à jour `dossiers.statut_id` automatiquement à chaque insertion dans `historique_statuts`.

**Question pour la revue** : valide-t-on une dénormalisation gérée par l'application (dans une transaction), ou préfère-t-on un trigger DB pour garantir la cohérence même en cas de bug applicatif ?

### 3. JSONB pour `dossier_donnees_formulaire`
**Contexte** : les champs des blocs "situation professionnelle", "provenance", etc. varient par entité — stockés en JSONB plutôt qu'en colonnes figées.

- **Avantage** : onboarding d'une nouvelle entité sans migration de schéma pour ses champs de formulaire spécifiques.
- **Risque** : pas de contrainte FK/type native sur le contenu JSONB, validation entièrement déportée côté applicatif (zod). Requêtes d'agrégation sur un champ interne plus complexes (indexation JSONB/GIN possible si besoin, mais à mettre en place explicitement).

**Question pour la revue** : le compromis flexibilité (JSONB) contre requêtabilité native (colonnes) est-il acceptable, notamment si le RH ou le tableau de bord doivent un jour filtrer sur un champ précis propre à une seule entité ?

### 4. Chiffrement applicatif du NIR
**Contexte** : déjà tranché en amont (chiffrement applicatif, colonnes `nir` + `nir_iv`), mais reste un point sensible RGPD qui mérite une dernière relecture architecture/sécurité avant la première migration.

Points à figer avec le développeur senior :
- Algorithme retenu (AES-256-GCM recommandé)
- Emplacement et rotation de la clé de chiffrement (variable d'environnement simple, ou coffre-fort de secrets type Azure Key Vault vu que la DB est déjà chez Azure ?)
- Quels rôles/endpoints ont accès au NIR déchiffré, et comment ça s'articule avec `journal_audit`
- Sauvegardes de la base : s'assurer que la clé de chiffrement n'est jamais sauvegardée avec les données chiffrées (sinon le chiffrement devient inutile)
