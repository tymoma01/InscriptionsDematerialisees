// Groupes de rôles centralisés (audit 2026-09-25, rôle Planning) — miroir de
// backend/src/core/auth/rbac.js (ROLES_ACCUEIL/ROLES_FORCAGE) : dupliqué plutôt que partagé entre
// front et back (convention déjà en place sur ce projet, voir CLAUDE.md), mais UN SEUL fichier
// côté front désormais, au lieu des conditions `['accueil_coordination', 'admin']`/`roleCode ===
// 'admin'` recopiées dans chaque page/composant qui en avait besoin.
//
// ROLES_ACCUEIL : tout ce qu'Accueil/Coordination peut voir/faire — Planning en hérite
// intégralement (mêmes onglets de navigation, mêmes pages, mêmes actions).
export const ROLES_ACCUEIL = ['accueil_coordination', 'planning'];
// ROLES_FORCAGE : qui voit/peut utiliser "Forcer le statut" (Validation.jsx) — Admin, plus
// Planning.
export const ROLES_FORCAGE = ['admin', 'planning'];
// Périmètre DPAE — miroir EXACT de backend/src/core/auth/rbac.js (révisé le 2026-09-30) :
// l'Admin a toutes les actions ; Accueil/Coordination n'a plus aucun accès DPAE.
// ROLES_DPAE_DEMANDEUR : créer une demande, ajouter un site d'affectation — Planning et Admin.
export const ROLES_DPAE_DEMANDEUR = ['planning', 'admin'];
// ROLES_DPAE_RH : traitement RH (file RH, valider/rejeter) — RH et Admin.
export const ROLES_DPAE_RH = ['rh', 'admin'];
// ROLES_DPAE_CONSULTATION : consulter des demandes (liste de suivi, fiche).
export const ROLES_DPAE_CONSULTATION = ['admin', 'rh', 'planning'];
// ROLES_DPAE_CONSULTATION_TOUTES : voir TOUTES les demandes de l'entité (filtre « Mes demandes /
// Toutes », par défaut Toutes) — Admin, RH et Planning (Planning ajouté le 2026-09-30, décision
// utilisateur confirmée), comme côté serveur.
export const ROLES_DPAE_CONSULTATION_TOUTES = ['admin', 'rh', 'planning'];
