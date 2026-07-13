# CLAUDE.md — Plateforme d'inscriptions dématérialisées ACCECIT

## Contexte du projet

ACCECIT est une agence de recrutement et de mise à disposition de personnel (secteurs **hôtellerie** et **tertiaire**). Le processus d'inscription des candidats est aujourd'hui entièrement manuel (dossiers papier, planification des tests sur tableur Excel).

Ce projet consiste à développer un **outil interne** pour digitaliser ce processus : un formulaire d'inscription mobile-first pour les candidats, et un back-office pour les recruteurs.

Il s'agit d'un projet de **stage de thèse professionnelle** (6 mois, juillet 2026 – janvier 2027), encadré par un développeur senior et une manager (Florence Venisse).

## Stack technique

- **Front-end** : React (créé avec Vite)
- **Back-end** : Node.js
- **Base de données** : à définir
- **Linter** : ESLint
- **Versioning** : Git / GitHub — dépôt privé `tymoma01/InscriptionsDematerialisees`
- **Éditeur** : VS Code
- **OS de développement** : Ubuntu Linux

## Décision d'architecture

Une alternative avait été étudiée : utiliser **SmartOF** (SaaS de gestion d'organisme de formation, déjà utilisé par l'entreprise pour la partie formation). Cette option a été **écartée** au profit d'un développement interne.

SmartOF reste présent dans le SI de l'entreprise pour la gestion des formations — une articulation avec l'outil pourra être étudiée ultérieurement, mais ce n'est pas au périmètre actuel.

## Parcours fonctionnel cible

1. **Entrée candidat** — QR code affiché en agence ou en salon, scanné par le candidat avec son propre smartphone
2. **Formulaire d'inscription** (mobile-first) — 5 blocs :
   - Informations personnelles (nom, naissance, n° SS, situation familiale)
   - Coordonnées (adresse, téléphone, email, contact d'urgence)
   - Situation professionnelle (n° France Travail, disponibilités, langues, poste, CV)
   - Provenance et préférence (comment connu, poste souhaité : bureau ou hôtel)
   - Consentements RGPD + signature
3. **Pièces justificatives** — upload PDF ou photo : pièce d'identité, carte vitale, RIB, justificatif de domicile. Liaison automatique au dossier candidat.
4. **Back-office recruteur** — filtres, indicateur de complétude, demande de complément, commentaires
5. **Fiches de test** — différenciées par secteur (tertiaire / hôtellerie) et par expérience (avec / sans)
6. **Envoi en test** — attribution selon poste et disponibilité, synchronisation avec l'agenda des formateurs
7. **Gestion des absences** — nouveau RDV ou classement avec motif
8. **Notifications** — SMS et email (convocation, relance, confirmation), historique conservé
9. **Décision finale** — validé (récupération des tenues, affectation sur mission) ou refusé avec motif
10. **Tableau de bord** — indicateurs de pilotage et filtres

## Statuts du dossier candidat

`Nouveau` → `En attente de documents` → `Complet` → `En cours d'étude` → `Envoyé en test` → `Validé` / `Refusé`

## Contraintes RGPD (structurantes)

Le dossier contient des **données sensibles** : numéro de sécurité sociale, pièce d'identité, RIB.

- Consentement explicite du candidat à chaque étape
- Droit de modification et de suppression des données
- Conservation limitée à **1 an** pour les candidats non retenus
- Hébergement sécurisé, accès différencié par profil (recruteur / formateur)
- Traçabilité complète des actions effectuées sur un dossier
- Stockage des documents sur cloud sécurisé dédié

## Besoins issus du terrain (observations)

- **Lucas** (chargé des inscriptions) : vérifie physiquement les pièces à l'accueil avant toute saisie. L'accueil est engorgé par des candidats aux objectifs hétérogènes.
- **Olga** (coordination) : valide les profils, planifie les tests et formations, effectue les relances et reprogrammations. **Aucun moyen d'anticiper les désistements** — principal point de perte de temps.
- Le **second contrôle RH** nécessite de pouvoir télécharger/exporter les dossiers candidats.

## Conventions de code

- Code et commentaires en **français** (noms de variables métier : `candidat`, `dossier`, `pieceJustificative`...)
- Commits en français, messages descriptifs
- Respect des règles ESLint du projet

## Comment m'assister

**Important** : je suis en apprentissage, sans expérience préalable de développement.

- Explique **chaque étape avant de l'exécuter** — je dois comprendre ce que je fais, pas seulement obtenir un résultat
- Donne les commandes **une à la fois**, avec vérification entre chaque
- Explique le **pourquoi** des choix techniques, pas seulement le comment
- Signale les erreurs de compréhension plutôt que de les contourner silencieusement
- Privilégie les solutions **simples et lisibles** aux solutions élégantes mais complexes
- Ce projet alimente une thèse professionnelle : les décisions techniques et leurs justifications doivent pouvoir être expliquées et documentées
