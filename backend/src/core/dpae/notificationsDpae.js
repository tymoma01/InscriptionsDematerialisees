// Notifications internes d'une demande DPAE : une notification par action, envoyée aux parties
// concernées (cloche, via core/notifications/notificationService.js — aucun second système).
//
// Parties d'une demande :
//   - demandeur : l'utilisateur qui l'a créée ;
//   - Planning  : tous les comptes actifs du rôle Planning, si la demande suit le circuit Planning ;
//   - RH        : tous les comptes actifs du rôle RH, si la demande leur a été envoyée (date_envoi_rh).
// Règles communes : l'auteur de l'action n'est jamais notifié, un utilisateur ne reçoit qu'une
// notification par action, et la RH n'est jamais notifiée d'une demande qu'elle ne peut pas voir.

const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');
const statutsDpae = require('./statutsDpae');
const { ROLES } = require('../auth/rbac');
const { aPermission } = require('../auth/permissions');

const PARTIE_DEMANDEUR = 'demandeur';
const PARTIE_PLANNING = 'planning';
const PARTIE_RH = 'rh';
const TOUTES_LES_PARTIES = Object.freeze([PARTIE_DEMANDEUR, PARTIE_PLANNING, PARTIE_RH]);

const LONGUEUR_EXTRAIT_NOTE = 80;

function lienDemande(demandeId) {
  return `/rh/dpae/${demandeId}`;
}

function nomAffiche(prenom, nom) {
  return `${prenom} ${String(nom).toLocaleUpperCase('fr-FR')}`;
}

// 80 premiers caractères de la note, sur une seule ligne.
function extraireNote(note) {
  const texte = String(note).replace(/\s+/g, ' ').trim();
  return texte.length > LONGUEUR_EXTRAIT_NOTE ? `${texte.slice(0, LONGUEUR_EXTRAIT_NOTE).trimEnd()}…` : texte;
}

// « DPAE n° 7 – Sophie MARTIN : validée par Olga VIDAL (Planning) », suivi de l'extrait d'une note.
function composerMessage({ demande, action, auteur, note }) {
  const base = `DPAE n° ${demande.id} – ${nomAffiche(demande.salarie_prenom, demande.salarie_nom)} : ${action} par ${nomAffiche(auteur.prenom, auteur.nom)} (${auteur.role_libelle})`;
  return note ? `${base} – « ${extraireNote(note)} »` : base;
}

// Une demande suit le circuit Planning quand elle a été créée par un rôle soumis au Planning
// (Inspecteur Hôtellerie), ou qu'elle est actuellement chez le Planning ou renvoyée à l'inspecteur.
function suitCircuitPlanning({ roleDemandeur, demande }) {
  return aPermission(roleDemandeur, 'dpaeCreationSoumiseAuPlanning') || statutsDpae.STATUTS_AVANT_RH.includes(demande.statut);
}

// Fonction pure : identifiants à notifier, sans doublon et sans l'auteur. `parties` : parties visées par
// l'action ; une partie visée mais absente de la demande (Planning hors circuit, RH sans envoi) est ignorée.
function choisirDestinataires({ parties, auteurId, demandeur, circuitPlanning, envoyeeALaRh, idsPlanning, idsRh }) {
  const ids = [];
  if (parties.includes(PARTIE_DEMANDEUR) && demandeur?.actif) ids.push(demandeur.id);
  if (parties.includes(PARTIE_PLANNING) && circuitPlanning) ids.push(...idsPlanning);
  if (parties.includes(PARTIE_RH) && envoyeeALaRh) ids.push(...idsRh);
  return [...new Set(ids)].filter((id) => id !== auteurId);
}

// Notifications d'une action sur une demande, sans les enregistrer (appliquerTransition les insère dans sa
// transaction). `demande` : état avant l'action (id, statut, demandeur_id, date_envoi_rh, salarie_*).
// `rhConcernee` : l'action vient d'envoyer la demande à la RH (date_envoi_rh pas encore lisible).
// `circuitPlanning` : force le circuit Planning (réactivation vers le Planning).
async function construireNotifications(trx, entite, demande, { auteurId, type, action, parties, note, rhConcernee = false, circuitPlanning }) {
  const [auteur, demandeur] = await Promise.all([
    demandeDpaeRepository.trouverUtilisateurAvecRole(trx, entite.id, auteurId),
    demandeDpaeRepository.trouverUtilisateurAvecRole(trx, entite.id, demande.demandeur_id),
  ]);
  const dansLeCircuit = circuitPlanning ?? suitCircuitPlanning({ roleDemandeur: demandeur?.role_code, demande });
  const envoyeeALaRh = rhConcernee || Boolean(demande.date_envoi_rh);

  const idsPlanning = parties.includes(PARTIE_PLANNING) && dansLeCircuit ? await demandeDpaeRepository.listerIdsUtilisateursActifsParRole(trx, entite.id, ROLES.PLANNING) : [];
  const idsRh = parties.includes(PARTIE_RH) && envoyeeALaRh ? await demandeDpaeRepository.listerIdsUtilisateursActifsParRole(trx, entite.id, ROLES.RH) : [];

  const destinataires = choisirDestinataires({ parties, auteurId, demandeur, circuitPlanning: dansLeCircuit, envoyeeALaRh, idsPlanning, idsRh });
  const message = composerMessage({ demande, action, auteur, note });
  return destinataires.map((utilisateurId) => ({
    entiteId: entite.id,
    utilisateurId,
    type,
    tableCible: 'demandes_dpae',
    cibleId: demande.id,
    message,
    lien: lienDemande(demande.id),
  }));
}

// Même chose, enregistrée dans la transaction de l'appelant (création, modification, note).
async function notifierAction(trx, entite, demande, options) {
  const notifications = await construireNotifications(trx, entite, demande, options);
  await notificationService.creerNotifications(trx, notifications);
}

module.exports = {
  PARTIE_DEMANDEUR,
  PARTIE_PLANNING,
  PARTIE_RH,
  TOUTES_LES_PARTIES,
  extraireNote,
  composerMessage,
  suitCircuitPlanning,
  choisirDestinataires,
  construireNotifications,
  notifierAction,
};
