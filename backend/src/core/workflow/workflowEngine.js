const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const workflowRepository = require('./workflowRepository');
const motifRepository = require('../motifs/motifRepository');
// rendezvousRepository (couche données, pas rendezvousService) : reste au même niveau que les
// autres dépendances de ce moteur générique (dossierRepository/workflowRepository/motifRepository,
// toutes des repositories, jamais un service métier) — voir neutraliserRendezvousActifsDossier
// ci-dessous, seul point d'usage.
const rendezvousRepository = require('../rendezvous/rendezvousRepository');
const { ROLES } = require('../auth/rbac');

// Valeur de `rendezvous.statut` pour un rendez-vous neutralisé — même sentinel que
// rendezvousService.STATUT_REMPLACE (core/rendezvous/rendezvousService.js), dupliquée ici plutôt
// que réimportée : rendezvousService.js porte de la logique métier propre au domaine rendez-vous
// (capacité formateur, délai de replanification...), pas seulement de l'accès aux données — ce
// moteur générique importe uniquement des repositories (voir ci-dessus), jamais un service métier,
// pour ne pas remonter de dépendance dans l'autre sens. Les deux valeurs DOIVENT rester
// synchronisées à la main (même convention que STATUTS_DOSSIER_RENDEZVOUS_CLOS, dupliqué entre
// front et back sur ce projet, voir CLAUDE.md conventions).
const STATUT_RENDEZVOUS_REMPLACE = 'remplace';

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
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
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
    throw new Error('Un commentaire est obligatoire pour tout changement de statut.');
  }

  const bd = bdExistante ?? (await db.obtenirKnex());
  const dossier = await trouverDossierOuEchouer(bd, entite, dossierId);

  const transition = await workflowRepository.trouverTransition(bd, entite.id, dossier.statut_id, codeAction);
  if (!transition) {
    throw new Error(`Action "${codeAction}" non autorisée depuis le statut courant du dossier "${dossierId}".`);
  }

  const autorisee = await workflowRepository.transitionAutoriseePourRole(bd, transition.id, roleCode);
  if (!autorisee) {
    throw new Error(`Rôle "${roleCode}" non autorisé pour l'action "${codeAction}".`);
  }

  let motifId = null;
  if (transition.motif_requis) {
    if (!motifCode) {
      throw new Error(`Un motif est obligatoire pour l'action "${codeAction}".`);
    }
    // categorie === codeAction : voir en-tête de fichier.
    const motif = await motifRepository.trouverMotifParCode(bd, entite.id, codeAction, motifCode);
    if (!motif) {
      throw new Error(`Motif "${motifCode}" non configuré pour l'action "${codeAction}" de l'entité « ${entite.code} ».`);
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
// Effets de bord alignés sur appliquerTransition (demande explicite) : neutralise tout
// rendez-vous encore actif si le statut D'ARRIVÉE le demande (statuts.neutralise_rendezvous_actifs,
// même mécanisme, voir son commentaire plus haut) — un saut direct vers un statut terminal
// (ex. formation_non_validee) ne doit pas plus laisser de rendez-vous orphelin qu'un parcours
// normal.
async function forcerStatut(entite, { dossierId, statutCode, commentaire, utilisateurId, roleCode }) {
  if (roleCode !== ROLES.ADMIN) {
    throw new Error('Seul le rôle Admin peut forcer le statut d’un dossier.');
  }
  if (!commentaire || !commentaire.trim()) {
    throw new Error('Un commentaire est obligatoire pour forcer un changement de statut.');
  }

  const bd = await db.obtenirKnex();
  const dossier = await dossierRepository.trouverDossierAvecStatutParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }

  const statutCible = await dossierRepository.trouverStatutParCode(bd, entite.id, statutCode);
  if (!statutCible) {
    throw new Error(`Statut "${statutCode}" introuvable pour l'entité « ${entite.code} ».`);
  }
  if (statutCible.id === dossier.statut_id) {
    throw new Error(`Le dossier "${dossierId}" est déjà au statut "${statutCode}".`);
  }

  await bd.transaction(async (trx) => {
    await dossierRepository.enregistrerChangementStatut(trx, {
      dossierId,
      statutId: statutCible.id,
      utilisateurId,
      commentaire,
    });

    if (statutCible.neutralise_rendezvous_actifs) {
      await rendezvousRepository.neutraliserRendezvousActifsDossier(trx, {
        dossierId,
        statutRemplace: STATUT_RENDEZVOUS_REMPLACE,
      });
    }
  });

  return {
    statutAvantCode: dossier.statut_code,
    statutAvantLibelle: dossier.statut_libelle,
    statutApresCode: statutCible.code,
    statutApresLibelle: statutCible.libelle,
  };
}

module.exports = {
  appliquerTransition,
  listerTransitionsDisponibles,
  listerMotifsPourAction,
  forcerStatut,
};
