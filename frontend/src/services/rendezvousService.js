import api from './api';

// Service dédié aux rendez-vous — encapsule les appels réseau pour que GestionRendezvous.jsx
// n'ait pas à connaître la forme exacte de l'API back-end (même principe que
// pieceJustificativeService.js / relanceService.js).

export async function listerRendezvous(dossierId) {
  const { data } = await api.get(`/dossiers/${dossierId}/rendezvous`);
  return data;
}

// motifCode obligatoire côté serveur pour statut 'absent'/'annule' (voir
// backend/src/core/rendezvous/rendezvousService.js) — pas revérifié ici, seulement dans le
// formulaire (voir GestionRendezvous.jsx) : la validation front est un confort, jamais la seule
// garde-fou.
export async function changerStatutRendezvous(dossierId, rendezvousId, { statut, motifCode }) {
  const { data } = await api.patch(`/dossiers/${dossierId}/rendezvous/${rendezvousId}`, { statut, motifCode });
  return data;
}

// Motifs de désistement configurés pour l'entité courante (table `motifs`) — sert à construire
// le menu déroulant sans coder de code en dur côté front (voir Modularité, CLAUDE.md).
export async function listerMotifsDesistement() {
  const { data } = await api.get('/dossiers/rendezvous/motifs-desistement');
  return data;
}

// Planifie un nouveau rendez-vous (ex. rendez-vous de test, voir CaptureTablette.jsx) — le back
// revalide tout (dossier/entité, rôle du formateur, créneau déjà pris), voir
// backend/src/core/rendezvous/rendezvousService.js. Ne change aucun statut de dossier — pour un
// rendez-vous qui doit s'accompagner d'un changement de statut atomique, voir
// creerRendezvousAvecTransitions ci-dessous.
export async function creerRendezvous(dossierId, { typeRdv, dateHeure, formateurId }) {
  const { data } = await api.post(`/dossiers/${dossierId}/rendezvous`, { typeRdv, dateHeure, formateurId });
  return data;
}

// Crée le rendez-vous et applique une ou plusieurs transitions de statut du dossier en une seule
// transaction côté back (voir backend/src/core/rendezvous/planificationRendezvousService.js) :
// soit tout réussit, soit rien n'est enregistré — remplace l'ancien enchaînement
// creerRendezvous() + appliquerTransition() séparés, qui pouvait laisser un rendez-vous créé sans
// le changement de statut correspondant si la seconde étape échouait (voir CaptureTablette.jsx).
// transitions : liste ordonnée de { codeAction, commentaire, motifCode? }.
export async function creerRendezvousAvecTransitions(dossierId, { typeRdv, dateHeure, formateurId, transitions }) {
  const { data } = await api.post(`/dossiers/${dossierId}/rendezvous/avec-transitions`, {
    typeRdv,
    dateHeure,
    formateurId,
    transitions,
  });
  return data;
}

// Vue d'ensemble des rendez-vous de test, tous dossiers confondus (page Planification côté
// Coordination) — distinct de listerRendezvous ci-dessus, qui liste ceux d'UN dossier précis.
export async function listerRendezvousTest({ aVenir, formateurId } = {}) {
  const { data } = await api.get('/dossiers/rendezvous', { params: { aVenir, formateurId } });
  return data;
}
