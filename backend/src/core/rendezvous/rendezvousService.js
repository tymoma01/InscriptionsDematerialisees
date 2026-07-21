const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');

const CATEGORIE_MOTIF_DESISTEMENT = 'desistement';

const STATUTS_AUTORISES = ['prevu', 'confirme', 'absent', 'annule'];
// Statuts qui constituent un désistement (CLAUDE.md, besoin Accueil/Coordination : "motif de
// désistement enregistré systématiquement, pour objectiver le phénomène et nourrir le futur
// tableau de bord") — 'absent' (non présenté le jour J) et 'annule' (désistement annoncé à
// l'avance) sont les deux façons dont un candidat ne donne pas suite à un rendez-vous.
const STATUTS_DESISTEMENT = ['absent', 'annule'];

// dossierId vient toujours de l'URL (voir rendezvous.routes.js) : jamais traité sans confirmer
// au préalable qu'il appartient à l'entité résolue par entiteContext, même faille IDOR déjà
// corrigée pour les pièces justificatives et les relances.
async function verifierDossierAppartientEntite(bd, entite, dossierId) {
  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier) {
    throw new Error(`Dossier "${dossierId}" introuvable pour l'entité « ${entite.code} ».`);
  }
}

async function listerRendezvous(entite, dossierId) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);
  return rendezvousRepository.listerRendezvousParDossier(bd, dossierId);
}

// Le cœur du besoin : passer un rendez-vous à 'absent' ou 'annule' SANS motif valide échoue —
// « systématiquement » n'est pas une option laissée à l'agent, c'est une règle imposée ici,
// jamais contournable depuis le front (même principe que la revalidation serveur des autres
// règles métier du projet — la validation front ne suffit jamais à elle seule).
async function changerStatutRendezvous(entite, { dossierId, rendezvousId, statut, motifCode }) {
  if (!STATUTS_AUTORISES.includes(statut)) {
    throw new Error(`Statut de rendez-vous "${statut}" invalide (attendu : ${STATUTS_AUTORISES.join(', ')}).`);
  }

  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);

  const rendezvous = await rendezvousRepository.trouverRendezvousParId(bd, entite.id, rendezvousId);
  if (!rendezvous || rendezvous.dossier_id !== Number(dossierId)) {
    throw new Error(`Rendez-vous "${rendezvousId}" introuvable pour le dossier "${dossierId}".`);
  }

  let motifId = null;
  if (STATUTS_DESISTEMENT.includes(statut)) {
    if (!motifCode) {
      throw new Error(`Un motif de désistement est obligatoire pour passer un rendez-vous au statut "${statut}".`);
    }
    const motif = await motifRepository.trouverMotifParCode(bd, entite.id, CATEGORIE_MOTIF_DESISTEMENT, motifCode);
    if (!motif) {
      throw new Error(`Motif de désistement "${motifCode}" non configuré pour l'entité « ${entite.code} ».`);
    }
    motifId = motif.id;
  }
  // Un statut hors désistement ('prevu'/'confirme') repart d'un motif nul : un motif de
  // désistement resterait trompeur si le rendez-vous est ensuite reprogrammé/reconfirmé.

  return rendezvousRepository.mettreAJourStatutRendezvous(bd, rendezvousId, { statut, motifId });
}

async function listerMotifsDesistement(entite) {
  const bd = await db.obtenirKnex();
  return motifRepository.listerMotifsParCategorie(bd, entite.id, CATEGORIE_MOTIF_DESISTEMENT);
}

module.exports = { listerRendezvous, changerStatutRendezvous, listerMotifsDesistement };
