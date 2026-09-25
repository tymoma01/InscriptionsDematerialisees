const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const workflowRepository = require('./workflowRepository');
const motifRepository = require('../motifs/motifRepository');
// rendezvousRepository (couche données, pas rendezvousService) : reste au même niveau que les
// autres dépendances de ce moteur générique (dossierRepository/workflowRepository/motifRepository,
// toutes des repositories, jamais un service métier) — voir neutraliserRendezvousActifsDossier
// ci-dessous, seul point d'usage.
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const { ROLES, ROLES_FORCAGE } = require('../auth/rbac');

// Valeur de `rendezvous.statut` pour un rendez-vous neutralisé — même sentinel que
// rendezvousService.STATUT_REMPLACE (core/rendezvous/rendezvousService.js), dupliquée ici plutôt
// que réimportée : rendezvousService.js porte de la logique métier propre au domaine rendez-vous
// (capacité formateur, délai de replanification...), pas seulement de l'accès aux données — ce
// moteur générique importe uniquement des repositories (voir ci-dessus), jamais un service métier,
// pour ne pas remonter de dépendance dans l'autre sens. Les deux valeurs DOIVENT rester
// synchronisées à la main (même convention que STATUTS_DOSSIER_RENDEZVOUS_CLOS, dupliqué entre
// front et back sur ce projet, voir CLAUDE.md conventions).
const STATUT_RENDEZVOUS_REMPLACE = 'remplace';

// forcerStatut (bloc 2, audit 2026-09-23) : valeur/motif distincts de STATUT_RENDEZVOUS_REMPLACE
// ci-dessus — 'remplace' reste réservé à une VRAIE replanification (un nouveau rendez-vous
// remplace effectivement l'ancien, voir rendezvousService.creerRendezvous/appliquerTransition
// ci-dessus) ; un forçage de statut, lui, n'en crée jamais — 'annule' est sémantiquement correct
// (le rendez-vous n'aura simplement plus lieu). Motif dédié en categorie 'systeme' (jamais
// 'desistement', voir scripts/seedMotifNeutraliseParForcage.js) : listerMotifsDesistement() ne doit
// jamais le proposer dans le menu agent "Marquer annulé"/"Marquer absent" (GestionRendezvous.jsx),
// ce n'est pas un motif qu'un agent choisit.
const STATUT_RENDEZVOUS_ANNULE = 'annule';
const CATEGORIE_MOTIF_SYSTEME = 'systeme';
const CODE_MOTIF_NEUTRALISE_PAR_FORCAGE = 'neutralise_par_forcage';

// Date d'embauche (audit 2026-09-25) — forcer un dossier vers ce statut doit renseigner
// dossiers.date_embauche exactement comme le parcours normal (embaucheService.marquerEmbauche,
// core/dossier/embaucheService.js), voir son usage dans forcerStatut ci-dessous. Même regex que
// embaucheService.REGEX_DATE_ISO (dupliquée, jamais importée : ce fichier n'a aucune dépendance
// vers un service métier, voir son en-tête).
const CODE_STATUT_EMBAUCHE = 'embauche';
const REGEX_DATE_EMBAUCHE = /^\d{4}-\d{2}-\d{2}$/;

// Erreur métier distincte d'une Error générique (500 opaque) — même principe que
// ErreurPieceJustificativeInvalide (pieceJustificativeService.js) et ErreurStatistiquesInvalide
// (statistiquesService.js) : les appelants HTTP (transitions.routes.js, mais aussi
// rendezvous.routes.js via planificationRendezvousService.js qui appelle appliquerTransition dans
// la même transaction qu'une création de rendez-vous) la traduisent en 400 avec un message
// directement affichable à l'agent. Avant ce correctif, tout rejet de ce moteur (action non
// autorisée depuis le statut courant, rôle non autorisé, motif manquant/invalide...) tombait dans
// le gestionnaire d'erreurs générique de app.js ("Une erreur est survenue. Merci de réessayer."),
// y compris pour un rejet parfaitement normal et attendu (ex. "Valider et planifier un test" cliqué
// sur un dossier dont le statut a changé entre-temps).
class ErreurTransitionInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurTransitionInvalide';
  }
}

// Moteur générique de la machine à états des dossiers (voir CLAUDE.md, contrainte de modularité
// n°1, et docs/architecture-technique.md §1.3) : ne connaît aucun statut ni transition nommés en
// dur. Toute la logique métier vit en configuration — `statuts`, `transitions_statut`, `motifs`
// (table `entite_id`-scopée, voir Modularité) — jamais dans ce fichier. Ajouter une entité ou une
// transition ne doit jamais nécessiter de modifier ce fichier, seulement les lignes de
// configuration correspondantes.
//
// Le motif d'une transition (`motif_requis`) est cherché dans `motifs` avec `categorie ===
// codeAction` : chaque action porte son propre vocabulaire de motifs, sans registre supplémentaire
// à tenir à jour — ajouter une nouvelle transition à motif obligatoire se fait entièrement en
// données (une ligne `transitions_statut` + des lignes `motifs`), jamais en code.
//
// Rôle par transition (`transition_roles`, migration 006) : politique "fail closed" — une
// transition sans aucune ligne `transition_roles` configurée est injouable par tout le monde,
// pas ouverte par défaut. Corollaire pour qui configure une nouvelle entité/transition : oublier
// scripts/seedTransitionRoles.js rend l'action inutilisable via l'API (erreur explicite), jamais
// silencieusement accessible à un rôle non prévu — voir scripts/seedTransitionRoles.js.

// dossierId vient toujours de l'URL (voir transitions.routes.js) : jamais traité sans confirmer
// au préalable qu'il appartient à l'entité résolue par entiteContext, même faille IDOR déjà
// corrigée pour les pièces justificatives, les relances et les rendez-vous.
async function trouverDossierOuEchouer(bd, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new ErreurTransitionInvalide(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  return dossier;
}

// Applique une transition : dossier → nouveau statut, en respectant `motif_requis`. Toute
// transition non déclarée dans `transitions_statut` pour le statut courant du dossier est
// refusée — impossible de sauter un statut ou d'appliquer une action non prévue par la
// configuration de l'entité, quel que soit ce qu'un client enverrait.
//
// bdExistante : permet à un appelant (voir planificationRendezvousService.js) de faire
// participer cette transition à une transaction déjà ouverte ailleurs — sans ça, chaque appel
// résout sa propre connexion et deux opérations censées être atomiques (créer un rendez-vous +
// avancer le statut du dossier) peuvent diverger si la seconde échoue après que la première a
// déjà été validée en base (voir l'incident constaté sur le dossier 62 : rendez-vous créés sans
// changement de statut correspondant).
async function appliquerTransition(
  entite,
  { dossierId, codeAction, motifCode, commentaire, utilisateurId, roleCode },
  bdExistante = null,
) {
  if (!commentaire || !commentaire.trim()) {
    throw new ErreurTransitionInvalide('Un commentaire est obligatoire pour tout changement de statut.');
  }

  const bd = bdExistante ?? (await db.obtenirKnex());
  const dossier = await trouverDossierOuEchouer(bd, entite, dossierId);

  const transition = await workflowRepository.trouverTransition(bd, entite.id, dossier.statut_id, codeAction);
  if (!transition) {
    throw new ErreurTransitionInvalide(`Action "${codeAction}" non autorisée depuis le statut courant du dossier "${dossierId}".`);
  }

  const autorisee = await workflowRepository.transitionAutoriseePourRole(bd, transition.id, roleCode);
  if (!autorisee) {
    throw new ErreurTransitionInvalide(`Rôle "${roleCode}" non autorisé pour l'action "${codeAction}".`);
  }

  let motifId = null;
  if (transition.motif_requis) {
    if (!motifCode) {
      throw new ErreurTransitionInvalide(`Un motif est obligatoire pour l'action "${codeAction}".`);
    }
    // categorie === codeAction : voir en-tête de fichier.
    const motif = await motifRepository.trouverMotifParCode(bd, entite.id, codeAction, motifCode);
    if (!motif) {
      throw new ErreurTransitionInvalide(`Motif "${motifCode}" non configuré pour l'action "${codeAction}" de l'entité « ${entite.code} ».`);
    }
    motifId = motif.id;
  }

  await dossierRepository.enregistrerChangementStatut(bd, {
    dossierId,
    statutId: transition.statut_destination_id,
    utilisateurId,
    motifId,
    commentaire,
  });

  // Neutralise (jamais ne supprime) tout rendez-vous encore 'prevu'/'confirme' du dossier quand
  // le statut D'ARRIVÉE le demande (statuts.neutralise_rendezvous_actifs, migration 051) — audit
  // 2026-08-21, dossier #37 : jusqu'ici, rien n'empêchait un rendez-vous de rester actif
  // indéfiniment sur un dossier déjà passé à un statut clos (invalide, valide_pret_embauche,
  // valide_envoi_formation pour ACCECIT — configuré par entité, jamais nommé ici). Systématique
  // pour TOUTE transition menant à un tel statut, quel que soit l'appelant (bouton "Décision"
  // générique, bascule automatique...) : ne dépend d'aucune donnée fournie par l'appelant
  // au-delà de dossierId (déjà connu), contrairement à la création d'un rendez-vous (qui, elle,
  // reste hors de ce moteur générique — voir le commentaire d'en-tête de Validation.jsx sur le
  // bloc "Décision" masqué après l'incident du dossier #75 : un rendez-vous a besoin de
  // date/lieu/formateur que l'appelant seul connaît, une neutralisation n'a besoin de rien de
  // plus que le dossier lui-même, donc aucun effet de bord manquant possible ici).
  if (transition.statut_destination_neutralise_rendezvous_actifs) {
    await rendezvousRepository.neutraliserRendezvousActifsDossier(bd, {
      dossierId,
      statutRemplace: STATUT_RENDEZVOUS_REMPLACE,
    });
  }

  return { statutDestinationId: transition.statut_destination_id };
}

// Actions possibles depuis le statut courant d'un dossier, filtrées par ce que le rôle appelant
// est autorisé à déclencher (transition_roles) — sert au front à afficher uniquement les boutons
// que l'agent connecté peut réellement utiliser, sans connaître les codes d'action à l'avance
// (voir Modularité, CLAUDE.md).
async function listerTransitionsDisponibles(entite, dossierId, roleCode) {
  const bd = await db.obtenirKnex();
  const dossier = await trouverDossierOuEchouer(bd, entite, dossierId);
  return workflowRepository.listerTransitionsAutoriseesDepuisStatut(bd, entite.id, dossier.statut_id, roleCode);
}

// Motifs configurés pour une action donnée (categorie === codeAction, voir en-tête de fichier)
// — sert au front à construire le sélecteur de motif d'une transition à `motif_requis`, sans
// connaître les codes possibles à l'avance (voir Modularité, CLAUDE.md).
async function listerMotifsPourAction(entite, codeAction) {
  const bd = await db.obtenirKnex();
  return motifRepository.listerMotifsParCategorie(bd, entite.id, codeAction);
}

// Statuts exclus du forçage (bloc 3, audit 2026-09-25, décision utilisateur explicite) — EXCEPTION
// assumée au principe de généricité de ce fichier (voir son en-tête : "aucun statut ni transition
// nommés en dur") : ces codes sont des paliers hérités d'un ancien circuit de validation
// (workflow v2/v3, "en_attente_verdict"/"verdict_positif"/"verdict_negatif"/
// "en_attente_validation_recruteur"/"en_attente_verification"), jamais atteints par le parcours
// normal actuel, qu'aucun Admin/Planning n'a de raison légitime de choisir par forçage. Centralisés
// ici en un seul endroit plutôt que dispersés, pour rester le SEUL point à modifier si la liste
// change — un miroir de cette même liste existe côté frontend (ModaleForcerStatut.jsx), pour ne
// jamais proposer ces statuts dans la liste de choix (décision produit, pas seulement une
// validation serveur après coup).
//
// `valide`/`rejete` : hérités pour ACCECIT (ancien circuit recruteur, 0 dossier aujourd'hui) mais
// restent le vocabulaire ACTUEL du workflow Adaptel (dossier #46, entite adaptel, toujours à ce
// statut) — exclus donc UNIQUEMENT pour ACCECIT, jamais pour Adaptel ni pour une entité non listée
// ici (Modularité, CLAUDE.md : un code de statut n'a de sens que dans le workflow de son entité).
const STATUTS_EXCLUS_FORCAGE_TOUTES_ENTITES = [
  'en_attente_verification',
  'en_attente_verdict',
  'verdict_positif',
  'verdict_negatif',
  'en_attente_validation_recruteur',
];
const STATUTS_EXCLUS_FORCAGE_PAR_ENTITE = {
  accecit: ['valide', 'rejete'],
};
function statutsExclusForcage(codeEntite) {
  return [...STATUTS_EXCLUS_FORCAGE_TOUTES_ENTITES, ...(STATUTS_EXCLUS_FORCAGE_PAR_ENTITE[codeEntite] ?? [])];
}

// Changement de statut manuel/forcé (audit RBAC 2026-08-31, décision utilisateur) — contourne
// volontairement `transitions_statut` : contrairement à appliquerTransition ci-dessus, qui ne
// permet jamais de sauter une étape (une seule origine possible par transition, voir Modularité),
// cette action permet à un Admin de placer un dossier sur N'IMPORTE QUEL statut existant de
// l'entité, indépendamment du statut courant — pensée pour les cas exceptionnels (correction d'une
// erreur de saisie, rattrapage d'un dossier bloqué par un bug) que la machine à états normale ne
// couvre pas. `roleCode` revérifié ici (pas seulement par `requireRole(ROLES.ADMIN)` posé sur la
// route, voir transitions.routes.js) : dernier verrou avant écriture, même principe que le
// contournement ADMIN déjà en place dans pieceJustificativeService.js/evaluationEngine.js — cette
// action n'a par nature AUCUNE ligne `transition_roles` pour la protéger (elle ne passe justement
// pas par cette table), donc pas de politique "fail closed" équivalente sans ce filet.
//
// Voir docs/architecture-technique.md §7 (Synchronisation rendez-vous ↔ statut dossier) pour la
// vue d'ensemble de qui synchronise quoi — ce commentaire ne couvre que forcerStatut lui-même.
//
// Neutralise TOUJOURS tout rendez-vous encore actif du dossier (audit 2026-09-09, dossier #127 —
// décision utilisateur), contrairement à appliquerTransition ci-dessus qui, lui, ne le fait que si
// le statut D'ARRIVÉE le demande (statuts.neutralise_rendezvous_actifs). Ce flag reste correct pour
// une transition NORMALE (transitions_statut) : pour test_non_realise par exemple, le rendez-vous
// précis est déjà fermé en amont par l'appelant avec le vrai motif (voir
// clotureRendezvousAvecTransitionService.js, seul mécanisme qui connaît CE rendez-vous précis et
// POURQUOI), donc neutralise_rendezvous_actifs=false y est intentionnel, pas un oubli. forcerStatut
// n'a en revanche aucun équivalent : un saut arbitraire vers N'IMPORTE quel statut de l'entité, hors
// de toute transition déclarée, ne garantit jamais qu'un rendez-vous resté actif reste cohérent avec
// la nouvelle destination — laisser ce cas dépendre du même flag que le parcours normal a produit un
// dossier bloqué en "Test non réalisé" avec un rendez-vous toujours "prevu" pour une date future
// (dossier #127, audit du 2026-09-09 : test_non_realise porte neutralise_rendezvous_actifs=false
// pour ACCECIT, correct pour le bouton "Test non réalisé"/la bascule automatique, pas pour ce
// chemin-ci).
//
// `'annule'` + motif `neutralise_par_forcage` (bloc 2, audit 2026-09-23 — corrige un choix
// sémantiquement faux : 'remplace' doit rester réservé à une VRAIE replanification, où un nouveau
// rendez-vous remplace effectivement l'ancien — jamais le cas ici, forcerStatut n'en crée aucun).
// Motif résolu directement via motifRepository (déjà une dépendance de ce fichier, voir motif_requis
// des transitions plus haut) — PAS via rendezvousService.changerStatutRendezvous, qui reste hors de
// portée de ce moteur générique (voir l'en-tête de ce fichier, aucune dépendance vers un service
// métier) et qui, de toute façon, ne recherche un motif que dans categorie 'desistement' — ce
// nouveau motif est en 'systeme', catégorie distincte, jamais proposé dans le menu agent
// "Marquer annulé"/"Marquer absent". Résolu AVANT toute écriture (transaction pas encore ouverte) :
// un forçage doit échouer PROPREMENT (aucune écriture) si l'entité n'a pas encore ce motif seedé,
// plutôt que d'écrire un dossier déplacé avec des rendez-vous neutralisés sans motif exploitable.
//
// Retourne un objet par rendez-vous neutralisé (id/statutAvant/outlookEventId/formateurId, voir
// rendezvousRepository.neutraliserRendezvousActifsDossier) — plus riche qu'un simple id (avant ce
// correctif) : l'appelant (transitions.routes.js, POST /forcer-statut) en a besoin pour journaliser
// le VRAI statut d'origine de chaque rendez-vous et pour supprimer son événement Outlook le cas
// échéant — cette fonction reste un moteur générique, sans dépendance à journalAudit ni à
// graphCalendarService (voir l'en-tête de ce fichier).
async function forcerStatut(entite, { dossierId, statutCode, commentaire, dateEmbauche, utilisateurId, roleCode }) {
  // Admin et Planning (ROLES_FORCAGE, rbac.js — audit 2026-09-25, rôle Planning).
  if (!ROLES_FORCAGE.includes(roleCode)) {
    throw new ErreurTransitionInvalide('Seuls les rôles Admin et Planning peuvent forcer le statut d’un dossier.');
  }
  if (!commentaire || !commentaire.trim()) {
    throw new ErreurTransitionInvalide('Un commentaire est obligatoire pour forcer un changement de statut.');
  }

  const bd = await db.obtenirKnex();
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new ErreurTransitionInvalide(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }

  const statutCible = await dossierRepository.trouverStatutParCode(bd, entite.id, statutCode);
  if (!statutCible) {
    throw new ErreurTransitionInvalide(`Statut "${statutCode}" introuvable pour l'entité « ${entite.code} ».`);
  }
  if (statutCible.id === dossier.statut_id) {
    throw new ErreurTransitionInvalide(`Le dossier "${dossierId}" est déjà au statut "${statutCode}".`);
  }
  // Bloc 3 (audit 2026-09-25, décision utilisateur) — voir STATUTS_EXCLUS_FORCAGE_* ci-dessus.
  if (statutsExclusForcage(entite.code).includes(statutCible.code)) {
    throw new ErreurTransitionInvalide('Ce statut ne peut pas être choisi par forçage.');
  }
  // Date d'embauche (audit 2026-09-25, suite du bloc 3) — EXCEPTION assumée au principe de
  // généricité de ce fichier, même nature que STATUTS_EXCLUS_FORCAGE_* ci-dessus : forcer un
  // dossier vers "embauche" doit renseigner dossiers.date_embauche exactement comme le parcours
  // normal (embaucheService.marquerEmbauche), sinon la fiche resterait "Embauché" sans date. Même
  // regex que marquerEmbaucheBodySchema/embaucheService (AAAA-MM-JJ, aucune borne min/max — voir
  // leur commentaire respectif : une date future est un cas d'usage légitime).
  if (statutCible.code === CODE_STATUT_EMBAUCHE && (!dateEmbauche || !REGEX_DATE_EMBAUCHE.test(dateEmbauche))) {
    throw new ErreurTransitionInvalide(
      'Une date d’embauche valide (AAAA-MM-JJ) est obligatoire pour forcer le statut "embauche".',
    );
  }

  // Résolution AVANT toute écriture (voir commentaire ci-dessus) — fail fast, aucune transaction
  // ouverte à ce stade.
  const motifNeutralisation = await motifRepository.trouverMotifParCode(
    bd,
    entite.id,
    CATEGORIE_MOTIF_SYSTEME,
    CODE_MOTIF_NEUTRALISE_PAR_FORCAGE,
  );
  if (!motifNeutralisation) {
    throw new ErreurTransitionInvalide(
      `Motif neutralise_par_forcage absent pour cette entité « ${entite.code} » (voir scripts/seedMotifNeutraliseParForcage.js).`,
    );
  }

  const rendezvousNeutralises = await bd.transaction(async (trx) => {
    await dossierRepository.enregistrerChangementStatut(trx, {
      dossierId,
      statutId: statutCible.id,
      utilisateurId,
      commentaire,
    });

    // Même endroit que le parcours normal (dossiers.date_embauche, voir
    // embaucheService.marquerEmbauche/dossierRepository.mettreAJourDateEmbauche), dans la MÊME
    // transaction que le changement de statut ci-dessus — jamais l'un sans l'autre.
    if (statutCible.code === CODE_STATUT_EMBAUCHE) {
      await dossierRepository.mettreAJourDateEmbauche(trx, { dossierId, dateEmbauche });
    }

    return rendezvousRepository.neutraliserRendezvousActifsDossier(trx, {
      dossierId,
      statutRemplace: STATUT_RENDEZVOUS_ANNULE,
      motifId: motifNeutralisation.id,
    });
  });

  return {
    statutAvantCode: dossier.statut_code,
    statutAvantLibelle: dossier.statut_libelle,
    statutApresCode: statutCible.code,
    statutApresLibelle: statutCible.libelle,
    motifNeutralisationCode: motifNeutralisation.code,
    rendezvousNeutralises,
  };
}

module.exports = {
  ErreurTransitionInvalide,
  appliquerTransition,
  listerTransitionsDisponibles,
  listerMotifsPourAction,
  forcerStatut,
};
