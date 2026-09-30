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

// Pièces justificatives — miroir EXACT de backend/src/api/routes/pieces.routes.js (2026-09-30),
// pour n'afficher que les actions que le serveur accepte (aucun bouton menant à un 403).
// ROLES_GESTION_PIECES : ajouter, remplacer, renommer, vérifier, supprimer une pièce (écran
// « Gérer les pièces justificatives ») — Accueil/Coordination, Planning, Admin.
export const ROLES_GESTION_PIECES = [...ROLES_ACCUEIL, 'admin'];
// ROLES_EXPORT_ZIP_PIECES : « Télécharger toutes les pièces (ZIP) » d'un dossier — les mêmes, plus
// la RH (ajoutée le 2026-09-30).
export const ROLES_EXPORT_ZIP_PIECES = [...ROLES_GESTION_PIECES, 'rh'];
// ROLES_EXPORT_ZIP_PIECES_GROUPE : « Export des pièces » de plusieurs dossiers (Dossiers
// candidats) — miroir de dossiers.routes.js, RH non incluse.
export const ROLES_EXPORT_ZIP_PIECES_GROUPE = [...ROLES_ACCUEIL, 'admin'];

// Suivi d'un dossier (2026-09-30) — miroir des lectures serveur des onglets Tests (rendez-vous,
// rendezvous.routes.js ROLES_LECTURE_RENDEZVOUS), Relances (relances.routes.js
// ROLES_LECTURE_RELANCES) et Formation (formation.routes.js ROLES_LECTURE_FORMATION) : les trois
// sont ouvertes aux mêmes rôles, RH exclue.
export const ROLES_LECTURE_SUIVI_DOSSIER = [...ROLES_ACCUEIL, 'admin', 'formateur', 'inspecteur'];
// Actions groupées « Relances » et « Replanifier des tests » (Dossiers candidats) — miroir des
// écritures serveur (relances.routes.js ROLES_GESTION_RELANCES, rendezvous.routes.js
// ROLES_GESTION_RENDEZVOUS) : Accueil/Coordination, Planning, Admin.
export const ROLES_ACTIONS_GROUPEES_SUIVI = [...ROLES_ACCUEIL, 'admin'];
// Notes d'un dossier (lecture et ajout) — miroir de notes.routes.js ROLES_NOTES_DOSSIER : RH exclue.
export const ROLES_NOTES_DOSSIER = [...ROLES_ACCUEIL, 'admin', 'formateur', 'inspecteur'];
