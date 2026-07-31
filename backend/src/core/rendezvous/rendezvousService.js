const db = require('../../db/knex');
const dossierRepository = require('../dossier/dossierRepository');
const rendezvousRepository = require('./rendezvousRepository');
const motifRepository = require('../motifs/motifRepository');
const utilisateurRepository = require('../auth/utilisateurRepository');
const { ROLES } = require('../auth/rbac');

const CATEGORIE_MOTIF_DESISTEMENT = 'desistement';

// Un même formateur peut désormais évaluer jusqu'à 2 candidats sur un même créneau exact (ajout
// métier — auparavant 1 seul) : constante simple plutôt que pilotée par la config d'entité, cette
// demande ne visait qu'ACCECIT et ne mentionne aucune variation par entité.
const CAPACITE_MAX_FORMATEUR_PAR_CRENEAU = 2;

// Workflow v4 (retrait de en_attente_verdict, responsable de projet, 2026-07-31) : la
// replanification reste possible à tout moment tant que le dossier est test_planifie, SAUF dans
// les DELAI_MIN_REPLANIFICATION_MINUTES minutes précédant le rendez-vous actuel — passé ce seuil,
// le formateur peut déjà être en train d'évaluer le candidat, et une replanification créerait un
// nouveau rendez-vous sans que personne n'ait prévenu ni le formateur ni le candidat déjà sur
// place. Ne s'applique volontairement PAS à une replanification depuis test_non_realise/invalide
// (voir verifierDelaiAvantReplanification ci-dessous) : dans ces deux cas le formateur a déjà agi
// sur l'ancien rendez-vous (absence constatée ou test évalué), il n'y a plus de créneau en cours à
// protéger — seule une replanification qui laisse le dossier en test_planifie (donc le même
// rendez-vous encore "en attente") est concernée.
const DELAI_MIN_REPLANIFICATION_MINUTES = 30;
const CODE_ACTION_REPLANIFIER_TEST = 'replanifier_test';
const STATUT_PROTEGE_PAR_DELAI_REPLANIFICATION = 'test_planifie';

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

class ErreurDatePassee extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurDatePassee';
  }
}

class ErreurReplanificationTropTardive extends Error {
  constructor(message) {
    super(message);
    this.name = 'ErreurReplanificationTropTardive';
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

// Vue d'ensemble des rendez-vous de test de l'entité, tous dossiers confondus (page
// Planification côté Coordination) — contrairement à listerRendezvous ci-dessus, ne prend pas de
// dossierId : rien à vérifier côté IDOR, la portée est déjà l'entité entière (voir
// entiteContext), pas un dossier précis.
async function listerRendezvousTest(entite, { aVenirSeulement, formateurId, dateDebut, dateFin } = {}) {
  const bd = await db.obtenirKnex();
  return rendezvousRepository.listerRendezvousTest(bd, entite.id, { aVenirSeulement, formateurId, dateDebut, dateFin });
}

// Planifie un nouveau rendez-vous pour un dossier (ex. rendez-vous de test, CLAUDE.md étape
// "Envoi en test" : "attribution selon poste et disponibilité, date fixée, notification envoyée
// au formateur concerné"). Ne déclenche aucune transition de statut du dossier ici — c'est une
// action distincte (voir transitions.routes.js, codeAction "planifier_test" pour ACCECIT),
// exactement comme changerStatutRendezvous ci-dessus ne touche jamais dossiers.statut non plus.
//
// bdExistante : voir le commentaire équivalent dans workflowEngine.appliquerTransition — permet
// à planificationRendezvousService de faire participer cette création à une transaction déjà
// ouverte, pour que la création du rendez-vous et la transition de statut qui suit réussissent
// ou échouent ensemble.
async function creerRendezvous(entite, { dossierId, typeRdv, dateHeure, formateurId }, bdExistante = null) {
  // Ne jamais se fier uniquement au front (calendrier grisé + <input min>, voir
  // CalendrierDisponibiliteFormateur.jsx/ModalePlanificationTest.jsx) — même principe que les
  // autres règles métier de ce module (voir changerStatutRendezvous ci-dessus). Comparaison
  // d'instants réels (Date#getTime()), pas de dates calendaires : dateHeure est un datetime ISO
  // complet avec fuseau (voir creationRendezvousSchema, .datetime({offset:true})), donc "avant
  // maintenant" ne dépend d'aucun fuseau horaire particulier ici — contrairement au calendrier
  // front, qui doit lui choisir un fuseau (Europe/Paris) pour décider quel jour est "aujourd'hui".
  if (new Date(dateHeure).getTime() < Date.now()) {
    throw new ErreurDatePassee("La date du rendez-vous ne peut pas être antérieure à aujourd'hui.");
  }

  const bd = bdExistante ?? (await db.obtenirKnex());
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

    // Un même formateur ne peut pas être assigné à plus de CAPACITE_MAX_FORMATEUR_PAR_CRENEAU
    // rendez-vous 'prevu'/'confirme' au même horaire exact — voir
    // rendezvousRepository.compterRendezvousFormateurAuCreneau.
    const nombreDejaPresents = await rendezvousRepository.compterRendezvousFormateurAuCreneau(
      bd,
      formateurIdValide,
      dateHeure,
    );
    if (nombreDejaPresents >= CAPACITE_MAX_FORMATEUR_PAR_CRENEAU) {
      throw new ErreurCreneauPris(
        `Ce formateur a déjà ${CAPACITE_MAX_FORMATEUR_PAR_CRENEAU} rendez-vous prévus à ce créneau (créneau complet).`,
      );
    }
  }

  return rendezvousRepository.creerRendezvous(bd, {
    dossierId,
    typeRdv,
    dateHeure,
    formateurId: formateurIdValide,
  });
}

// Appelée par planificationRendezvousService AVANT de créer le nouveau rendez-vous, pour toute
// replanification (voir en-tête de fichier pour la portée exacte du garde-fou). `transitions`
// reçu tel quel depuis l'appelant, sans que celui-ci ait besoin de connaître le codeAction —
// planificationRendezvousService reste générique (voir Modularité, CLAUDE.md), c'est cette
// fonction, déjà ACCECIT-flavored (voir CAPACITE_MAX_FORMATEUR_PAR_CRENEAU ci-dessus), qui
// interprète le vocabulaire de transitions propre à ACCECIT. Ne fait rien (retour silencieux) si
// aucune des conditions du garde-fou n'est réunie : action différente, dossier déjà ailleurs que
// test_planifie, ou aucun rendez-vous actif à protéger.
async function verifierDelaiAvantReplanification(entite, dossierId, transitions, bdExistante = null) {
  if (!transitions.some((transition) => transition.codeAction === CODE_ACTION_REPLANIFIER_TEST)) {
    return;
  }

  const bd = bdExistante ?? (await db.obtenirKnex());

  const dossier = await dossierRepository.trouverDossierParId(bd, entite.id, dossierId);
  if (!dossier || dossier.statut_code !== STATUT_PROTEGE_PAR_DELAI_REPLANIFICATION) {
    return;
  }

  const rendezvousActuel = await rendezvousRepository.trouverRendezvousTestActifDossier(bd, dossierId);
  if (!rendezvousActuel) {
    return;
  }

  const seuil = new Date(rendezvousActuel.date_heure).getTime() - DELAI_MIN_REPLANIFICATION_MINUTES * 60_000;
  if (Date.now() >= seuil) {
    throw new ErreurReplanificationTropTardive(
      `Impossible de replanifier : le rendez-vous actuel est dans moins de ${DELAI_MIN_REPLANIFICATION_MINUTES} minutes (ou déjà passé) — le formateur peut déjà être en train d'évaluer le candidat.`,
    );
  }
}

module.exports = {
  listerRendezvous,
  changerStatutRendezvous,
  listerMotifsDesistement,
  listerRendezvousTest,
  creerRendezvous,
  verifierDelaiAvantReplanification,
  ErreurFormateurInvalide,
  ErreurCreneauPris,
  ErreurDatePassee,
  ErreurReplanificationTropTardive,
};
