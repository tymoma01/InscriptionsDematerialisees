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
// ROLES_DPAE_DEMANDEUR / ROLES_DPAE_RH : miroir de core/auth/rbac.js (module Demandes DPAE,
// 2026-09-28) — qui crée/suit une demande DPAE, et qui la traite côté RH.
export const ROLES_DPAE_DEMANDEUR = [...ROLES_ACCUEIL, 'admin'];
export const ROLES_DPAE_RH = ['rh', 'admin'];
