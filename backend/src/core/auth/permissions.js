// Matrice des permissions — SOURCE UNIQUE des droits par rôle, côté serveur ET côté front.
//
// Chaque clé est une permission (une action ou un écran), chaque valeur la liste des codes de rôle
// qui l'ont. Les routes la vérifient via requirePermission('cle') (api/middlewares/rbac.middleware.js) ;
// le front la reçoit avec la session (`utilisateur.permissions`, liste des clés accordées au rôle
// connecté, voir permissionsDuRole ci-dessous et auth.routes.js) et n'a donc AUCUNE liste de rôles
// à maintenir : ajouter un rôle ou modifier un droit se fait ici, et nulle part ailleurs.
//
// Les permissions d'écran (suffixe implicite « page… », ex. suiviTests, nouvelleInscription) ne
// gardent aucune route API : elles décident seulement de l'affichage d'un onglet ou d'un bouton.
// La sécurité reste portée par les permissions d'API de la page elle-même.
const { ROLES } = require('./rbac');

const {
  ACCUEIL_COORDINATION,
  PLANNING,
  FORMATEUR,
  INSPECTEUR,
  INSPECTEUR_HOTELLERIE,
  ADMIN,
  RH,
} = ROLES;

// Planning a tous les droits d'Accueil/Coordination (plus le forçage de statut).
const ACCUEIL = [ACCUEIL_COORDINATION, PLANNING];

const PERMISSIONS = {
  // --- Administration ---
  administration: [ADMIN],

  // --- Dossiers candidats ---
  listeDossiers: [...ACCUEIL, ADMIN, RH, INSPECTEUR_HOTELLERIE],
  consultationDossiers: [...ACCUEIL, ADMIN, RH],
  lectureInscription: [...ACCUEIL, ADMIN, RH, FORMATEUR, INSPECTEUR, INSPECTEUR_HOTELLERIE],
  modificationInscription: [...ACCUEIL, ADMIN],
  // Horodatage de dernière modification (actualisation automatique) : tout le back-office.
  toutBackOffice: [...ACCUEIL, ADMIN, RH, FORMATEUR, INSPECTEUR, INSPECTEUR_HOTELLERIE],
  gestionTransitions: [...ACCUEIL, ADMIN, FORMATEUR, INSPECTEUR],
  // Forçage de statut : mêmes droits pour Admin, Planning et RH (mêmes statuts cibles, mêmes effets).
  forcerStatut: [ADMIN, PLANNING, RH],
  marquerEmbauche: [...ACCUEIL, ADMIN],
  // Notes d'un dossier : la RH les lit et en ajoute comme le Planning (jamais de modification ni suppression).
  ajoutNotesDossier: [...ACCUEIL, ADMIN, RH, FORMATEUR, INSPECTEUR],
  lectureNotesDossier: [...ACCUEIL, ADMIN, RH, FORMATEUR, INSPECTEUR, INSPECTEUR_HOTELLERIE],

  // --- Pièces justificatives ---
  gestionPieces: [...ACCUEIL, ADMIN],
  consultationPieces: [...ACCUEIL, ADMIN, RH, FORMATEUR, INSPECTEUR],
  exportPieces: [...ACCUEIL, ADMIN, RH],
  exportPiecesGroupe: [...ACCUEIL, ADMIN],

  // --- Tests, relances, formation ---
  gestionRendezvous: [...ACCUEIL, ADMIN],
  lectureRendezvous: [...ACCUEIL, ADMIN, FORMATEUR, INSPECTEUR, INSPECTEUR_HOTELLERIE],
  consultationRendezvousTest: [...ACCUEIL, ADMIN, RH, FORMATEUR, INSPECTEUR],
  lectureDisponibilites: [...ACCUEIL, ADMIN],
  lectureFormateurs: [...ACCUEIL, ADMIN],
  gestionLieux: [...ACCUEIL, ADMIN],
  gestionRelances: [...ACCUEIL, ADMIN],
  lectureRelances: [...ACCUEIL, ADMIN, FORMATEUR, INSPECTEUR],
  evaluation: [ADMIN, FORMATEUR, INSPECTEUR],
  // Aucun dossier Tertiaire (secteur de l'Inspecteur) ne passe en formation.
  suiviFormation: [...ACCUEIL, ADMIN, FORMATEUR],
  lectureFormation: [...ACCUEIL, ADMIN, FORMATEUR, INSPECTEUR, INSPECTEUR_HOTELLERIE],

  // --- Tableau de bord ---
  statistiques: [...ACCUEIL, ADMIN, RH, INSPECTEUR_HOTELLERIE],

  // --- DPAE (Accueil/Coordination n'a aucun accès) ---
  dpaeCreation: [PLANNING, ADMIN, INSPECTEUR_HOTELLERIE],
  dpaeTraitementRh: [RH, ADMIN],
  dpaeConsultation: [ADMIN, RH, PLANNING, INSPECTEUR_HOTELLERIE],
  // Parmi eux, qui voit TOUTES les demandes de l'entité (les autres : seulement les leurs).
  dpaeConsultationToutes: [ADMIN, RH, PLANNING, INSPECTEUR_HOTELLERIE],
  // Modification d'une demande encore « À traiter » ou « En attente » : les rôles qui peuvent
  // modifier au moins leurs propres demandes (comme la création)…
  dpaeModification: [PLANNING, ADMIN, INSPECTEUR_HOTELLERIE],
  // … et, parmi eux, ceux qui peuvent modifier la demande de n'importe quel auteur (les autres :
  // seulement les leurs). Règle par demande : demandeDpaeService.peutModifierDemande.
  dpaeModificationToutes: [PLANNING, ADMIN],
  // Passage par le Planning : un Inspecteur Hôtellerie soumet ses demandes au Planning (qui les
  // transmet à la RH ou les lui renvoie) ; les autres rôles créateurs les envoient directement à la RH.
  dpaeCreationSoumiseAuPlanning: [INSPECTEUR_HOTELLERIE],
  dpaeValidationPlanning: [PLANNING, ADMIN],
  // Voir les demandes « À valider par le Planning » et « Renvoyée à l'inspecteur » : tous les rôles
  // de consultation sauf la RH, qui n'en a connaissance qu'une fois la demande transmise.
  dpaeVoitFilePlanning: [ADMIN, PLANNING, INSPECTEUR_HOTELLERIE],
  // Classer une demande sans suite (avant toute décision de la RH) : les rôles qui peuvent le faire sur
  // leurs propres demandes… et, parmi eux, ceux qui le peuvent sur celles de n'importe quel auteur.
  dpaeClassementSansSuite: [INSPECTEUR_HOTELLERIE, PLANNING, ADMIN],
  dpaeClassementSansSuiteToutes: [PLANNING, ADMIN],
  dpaeTableauDeBord: [ADMIN, RH, PLANNING],
  // Renvoyer une demande corrigée au Planning (« Renvoyée à l'inspecteur » -> « À valider par le Planning ») :
  // l'Inspecteur Hôtellerie auteur, ou l'Admin pour toute demande.
  dpaeEnvoiPlanning: [INSPECTEUR_HOTELLERIE, ADMIN],
  dpaeEnvoiPlanningToutes: [ADMIN],
  // Renvoyer à la RH une demande « En attente » une fois complétée : l'auteur (Inspecteur Hôtellerie), ou le
  // Planning et l'Admin pour toute demande.
  dpaeRetransmissionRh: [INSPECTEUR_HOTELLERIE, PLANNING, ADMIN],
  dpaeRetransmissionRhToutes: [PLANNING, ADMIN],
  // Réactiver une demande classée sans suite : l'Admin seulement.
  dpaeReactivation: [ADMIN],
  // Notes d'une demande : tous les rôles de consultation ; l'Inspecteur Hôtellerie seulement sur ses propres
  // demandes (dpaeNotesToutes pour les autres).
  dpaeNotes: [ADMIN, RH, PLANNING, INSPECTEUR_HOTELLERIE],
  dpaeNotesToutes: [ADMIN, RH, PLANNING],
  // Recherche d'un candidat pour le champ « Nom » d'une demande.
  rechercheCandidats: [PLANNING, ADMIN, INSPECTEUR_HOTELLERIE, RH],

  // --- Permissions d'écran (aucune route API associée) ---
  nouvelleInscription: [...ACCUEIL, ADMIN],
  suiviTests: [...ACCUEIL, ADMIN, FORMATEUR, INSPECTEUR],
  cloche: [ADMIN, RH, PLANNING, INSPECTEUR_HOTELLERIE],
};

for (const cle of Object.keys(PERMISSIONS)) Object.freeze(PERMISSIONS[cle]);
Object.freeze(PERMISSIONS);

function aPermission(roleCode, cle) {
  const roles = PERMISSIONS[cle];
  if (!roles) throw new Error(`Permission inconnue : « ${cle} »`);
  return roles.includes(roleCode);
}

// Clés accordées à un rôle — envoyées au front avec la session.
function permissionsDuRole(roleCode) {
  return Object.keys(PERMISSIONS).filter((cle) => PERMISSIONS[cle].includes(roleCode));
}

module.exports = { PERMISSIONS, aPermission, permissionsDuRole };
