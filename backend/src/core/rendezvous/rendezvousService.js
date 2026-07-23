const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const { ROLES } = require('../auth/rbac');

const CATEGORIE_MOTIF_DESISTEMENT = 'desistement';

const STATUTS_AUTORISES = ['prevu', 'confirme', 'absent', 'annule'];
// Statuts qui constituent un désistement (CLAUDE.md, besoin Accueil/Coordination : "motif de
// désistement enregistré systématiquement, pour objectiver le phénomène et nourrir le futur
// tableau de bord") — 'absent' (non présenté le jour J) et 'annule' (désistement annoncé à
// l'avance) sont les deux façons dont un candidat ne donne pas suite à un rendez-vous.
const STATUTS_DESISTEMENT = ['absent', 'annule'];

// Erreurs métier distinctes d'une Error générique (500 opaque) : rendezvous.routes.js les
// traduit en 400/409 avec un message directement affichable à l'agent — même principe que
// ErreurInscriptionConflit dans dossierService.js.
class ErreurFormateurInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurFormateurInvalide';
  }
}

class ErreurCreneauPris extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurCreneauPris';
  }
}

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

// Planifie un nouveau rendez-vous pour un dossier (ex. rendez-vous de test, CLAUDE.md étape
// "Envoi en test" : "attribution selon poste et disponibilité, date fixée, notification envoyée
// au formateur concerné"). Ne déclenche aucune transition de statut du dossier ici — c'est une
// action distincte (voir transitions.routes.js, codeAction "planifier_test" pour ACCECIT),
// exactement comme changerStatutRendezvous ci-dessus ne touche jamais dossiers.statut non plus.
async function creerRendezvous(entite, { dossierId, typeRdv, dateHeure, formateurId }) {
  const bd = await db.obtenirKnex();
  await verifierDossierAppartientEntite(bd, entite, dossierId);

  let formateurIdValide = null;
  if (formateurId != null) {
    const formateur = await utilisateurRepository.trouverUtilisateurParId(bd, entite.id, formateurId);
    if (!formateur || formateur.role_code !== ROLES.FORMATEUR) {
      throw new ErreurFormateurInvalide(
        `Utilisateur "${formateurId}" introuvable ou n'a pas le rôle formateur pour l'entité « ${entite.code} ».`,
      );
    }
    formateurIdValide = formateur.id;

    // Un même formateur ne peut pas être assigné à deux rendez-vous 'prevu'/'confirme' au même
    // horaire exact — voir rendezvousRepository.trouverRendezvousFormateurAuCreneau.
    const conflit = await rendezvousRepository.trouverRendezvousFormateurAuCreneau(bd, formateurIdValide, dateHeure);
    if (conflit) {
      throw new ErreurCreneauPris('Ce formateur a déjà un rendez-vous prévu à ce créneau.');
    }
  }

  return rendezvousRepository.creerRendezvous(bd, {
    dossierId,
    typeRdv,
    dateHeure,
    formateurId: formateurIdValide,
  });
}

module.exports = {
  listerRendezvous,
  changerStatutRendezvous,
  listerMotifsDesistement,
  creerRendezvous,
  ErreurFormateurInvalide,
  ErreurCreneauPris,
};
