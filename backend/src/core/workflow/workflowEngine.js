const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const workflowRepository = require('./workflowRepository');
const motifRepository = require('../motifs/motifRepository');

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

module.exports = { appliquerTransition, listerTransitionsDisponibles, listerMotifsPourAction };
