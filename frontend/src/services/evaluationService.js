import api from './api';

// Service dédié à l'évaluation du test — encapsule les appels réseau pour que les composants de
// core/evaluation/ n'aient pas à connaître la forme exacte de l'API back-end (même principe que
// relanceService.js / rendezvousService.js).

// Questionnaire résolu pour le poste donné (repli générique côté serveur si aucun questionnaire
// dédié n'existe pour ce poste, voir backend evaluationEngine.listerQuestionnaire) — posteCode
// omis si le dossier n'a aucun poste déclaré.
export async function obtenirQuestionnaire({ rendezvousId, posteCode }) {
  const { data } = await api.get('/evaluations/questionnaire', { params: { rendezvousId, posteCode } });
  return data;
}

// Déjà filtrée par le formateur connecté côté serveur (voir backend evaluations.routes.js) —
// jamais de formateurId envoyé ici.
export async function listerRendezvousAEvaluer() {
  const { data } = await api.get('/evaluations/a-faire');
  return data;
}

// Bouton "Présent(e)" (ListeEvaluationsAFaire.jsx, audit 2026-09-09) — marque la présence
// constatée du candidat, LE JOUR MÊME, avant même l'évaluation elle-même. N'a aucun effet visible
// sur le badge de statut du rendez-vous (voir backend evaluationEngine.marquerPresenceConfirmee) :
// exclut seulement ce rendez-vous de la bascule automatique "Test non réalisé", même passé le
// délai de grâce de 24h.
export async function marquerPresenceConfirmee(rendezvousId) {
  const { data } = await api.post(`/evaluations/${rendezvousId}/presence`);
  return data;
}

// blocs : [{ posteCode, reponses }] — un bloc par poste évalué (questionnaires empilés, voir
// GrilleEvaluation.jsx), un seul verdict global (resultatGlobal/orientation/commentaire) pour
// l'ensemble.
export async function enregistrerEvaluation({ rendezvousId, resultatGlobal, orientation, commentaire, blocs }) {
  const { data } = await api.post('/evaluations', {
    rendezvousId,
    resultatGlobal,
    orientation,
    commentaire,
    blocs,
  });
  return data;
}

// Évaluations déjà soumises par le formateur connecté — jamais tous formateurs confondus (voir
// backend evaluationEngine.listerHistorique), même principe que listerRendezvousAEvaluer ci-dessus.
export async function listerHistoriqueEvaluations() {
  const { data } = await api.get('/evaluations/historique');
  return data;
}

// Détail en lecture seule d'une évaluation déjà soumise (voir DetailEvaluation.jsx) — l'appartenance
// au formateur connecté est revérifiée côté serveur, pas seulement supposée parce que l'id vient
// de sa propre liste d'historique.
export async function obtenirDetailEvaluation(evaluationId) {
  const { data } = await api.get(`/evaluations/historique/${evaluationId}`);
  return data;
}

// Détail en lecture seule de la DERNIÈRE évaluation soumise pour un dossier (pas par
// evaluationId, voir obtenirDetailEvaluation ci-dessus) — Accueil/Coordination et Admin, depuis la
// fiche dossier "Étudier le dossier" (Validation.jsx, demande utilisateur 2026-09-10) : ces deux
// rôles n'ont pas accès à /evaluations/* (voir backend evaluations.routes.js, ROLES_EVALUATION),
// cette route dédiée sous /dossiers/:id vit donc côté back dans dossiers.routes.js, pas
// evaluations.routes.js. Renvoie `null` (jamais une erreur HTTP) si aucun test n'a encore été
// évalué pour ce dossier — état normal, pas une exception (voir backend
// evaluationEngine.obtenirDetailEvaluationDossier).
export async function obtenirEvaluationDossier(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/evaluation`);
  return data;
}
