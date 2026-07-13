# InscriptionsDematerialisees

## Contexte du projet

ACCECIT est une agence de recrutement et de mise à disposition de personnel (secteurs **hôtellerie** et **tertiaire**). Le processus d'inscription des candidats est aujourd'hui entièrement manuel (dossiers papier, planification des tests sur tableur Excel).

Ce projet consiste à développer un **outil interne** pour digitaliser ce processus : un formulaire d'inscription mobile-first pour les candidats, et un back-office pour les recruteurs.

## Besoins issus du terrain (observations)

- **Accueil et Coordination** (chargé des inscriptions) : vérifie physiquement les pièces à l'accueil avant toute saisie. L'accueil est engorgé par des candidats aux objectifs hétérogènes.

Une vue centralisée des dossiers en attente de validation, de test ou de relance, pourrait être envisageable. Un historique des relances effectuées par candidat, pour ne pas relancer en double ni perdre le fil des échanges. Un moyen de confirmer la présence à un créneau avant le jour J (rappel automatique), pour réduire les désistements de dernière minute. Un motif de désistement enregistré systématiquement, pour objectiver un phénomène aujourd'hui vécu comme aléatoire et pour nourrir, à terme, le tableau de bord de pilotage.

(coordination) : valide les profils, planifie les tests et formations, effectue les relances et reprogrammations. **Aucun moyen d'anticiper les désistements** - principal point de perte de temps.

- Le **second contrôle RH** nécessité de pouvoir télécharger/exporter les dossiers candidats.

## Stack technique

- **Front-end** : React
- **Back-end** : Node.js
- **Base de données** : à définir
- **Linter** : ESLint
- **Versioning** : Git / GitHub - dépôt privé `tymoma01/InscriptionsDematerialisees`
- **Éditeur** : VS Code

## Décision d'architecture

Une alternative avait été étudiée : utiliser **SmartOF** (SaaS de gestion d'organisme de formation, déjà utilisé par l'entreprise pour la partie formation). Cette option a été **écartée** au profit d'un développement interne.

SmartOF reste présent dans le SI de l'entreprise pour la gestion des formations. Une articulation devra etre possible avec l'outil ultérieurement.

## Parcours fonctionnel cible

1. **Entrée candidat** le candidat clique sur le lien de l'application
2. **Formulaire d'inscription** - 5 blocs :
   - Informations personnelles (nom, naissance, n° SS, situation familiale)
   - Coordonnées (adresse, téléphone, email, contact d'urgence)
   - Situation professionnelle (n° France Travail, disponibilités, langues, poste, CV)
   - Provenance et préférence (comment connu, poste souhaité : bureau ou hôtel)
   - Consentements RGPD + signature
3. **Pièces justificatives** - upload PDF ou photo : pièce d'identité, carte vitale, RIB, justificatif de domicile. 
4. **Back-office recruteur** - filtres, indicateur de complétude, demande de complément, commentaires, uploade les documents critiques
5. **Fiches de test** - différenciées par secteur (tertiaire / hôtellerie) et par expérience (avec / sans)
6. **Envoi en test** - attribution selon poste et disponibilité, synchronisation avec l'agenda des formateurs
7. **Gestion des absences** - nouveau RDV ou classement avec motif
8. **Notifications** - SMS et email (convocation, relance, confirmation), historique conservé
9. **évaluation des candidats en test selon des critères** - bonne hygiène, assiduité, respect des consignes,temps moyens du service (depart/recouche) etc...
10. **Décision finale** - validé (récupération des tenues, affectation sur mission) ou refusé avec motif
11. **Tableau de bord** - indicateurs de pilotage et filtres

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


## Conventions de code

- Code et commentaires en **français** (noms de variables métier : `candidat`, `dossier`, `pieceJustificative`...)
- Commits en français, messages descriptifs
- Respect des règles ESLint du projet


