// Orchestration des demandes DPAE — module spécifique à ACCECIT (voir Modularité, CLAUDE.md :
// pas de moteur générique configurable par entité ici, décision actée avec l'utilisateur), même
// découpage repository/service que le reste du projet (voir relanceService.js).

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');

const STATUT_ENVOYEE = 'envoyee';
const STATUT_VALIDEE = 'validee';
const STATUT_REJETEE = 'rejetee';

class ErreurDemandeIntrouvable extends Error {}
class ErreurDemandeDejaTraitee extends Error {}

function libelleSalarie(demande) {
  return `${demande.salarie_prenom} ${demande.salarie_nom}`;
}

async function verifierDemandeExiste(bd, entite, demandeId) {
  const demande = await demandeDpaeRepository.trouverDemandeParId(bd, entite.id, demandeId);
  if (!demande) {
    throw new ErreurDemandeIntrouvable(`Demande DPAE "${demandeId}" introuvable pour l'entité « ${entite.code} ».`);
  }
  return demande;
}

// Crée directement la demande à l'état 'envoyee' (pas de brouillon intermédiaire, voir migration
// 066). Correctif 2026-09-28 (simplification demandée par l'utilisateur, revient sur un premier
// essai plus compliqué — une notification stockée par RH à l'envoi, plus un rattrapage pour tout
// RH promu après coup) : plus aucune notification stockée ici. Tout RH voit "toutes les demandes
// en cours" directement depuis la liste live des demandes 'envoyee' (voir listerPourRh plus bas,
// consommée par NotificationsCloche.jsx pour ce rôle) — vrai dès l'instant où une demande existe,
// pour n'importe quel compte RH quelle que soit la date à laquelle il a obtenu ce rôle, sans
// synchronisation à maintenir.
async function creerEtEnvoyer(entite, demandeurId, donnees) {
  const bd = await db.obtenirKnex();
  return demandeDpaeRepository.creerDemande(bd, {
    ...donnees,
    entiteId: entite.id,
    demandeurId,
  });
}

async function listerMesDemandes(entite, demandeurId) {
  const bd = await db.obtenirKnex();
  return demandeDpaeRepository.listerDemandesParDemandeur(bd, entite.id, demandeurId);
}

// statut par défaut 'envoyee' (file à traiter) — un appelant qui veut l'historique complet
// (traitées incluses) passe explicitement statut=null (voir dpae.routes.js, ?statut=tous).
async function listerPourRh(entite, statut = STATUT_ENVOYEE) {
  const bd = await db.obtenirKnex();
  return demandeDpaeRepository.listerDemandesPourRh(bd, entite.id, statut);
}

async function obtenirDemande(entite, demandeId) {
  const bd = await db.obtenirKnex();
  return verifierDemandeExiste(bd, entite, demandeId);
}

async function valider(entite, demandeId, traitantId) {
  const bd = await db.obtenirKnex();
  const demande = await verifierDemandeExiste(bd, entite, demandeId);
  if (demande.statut !== STATUT_ENVOYEE) {
    throw new ErreurDemandeDejaTraitee(`Demande DPAE "${demandeId}" déjà traitée (statut « ${demande.statut} »).`);
  }

  await demandeDpaeRepository.marquerTraitee(bd, demandeId, { statut: STATUT_VALIDEE, traitantId });
  await notificationService.creerNotifications(bd, [
    {
      entiteId: entite.id,
      utilisateurId: demande.demandeur_id,
      type: 'demande_dpae_validee',
      tableCible: 'demandes_dpae',
      cibleId: demandeId,
      message: `Votre demande DPAE pour ${libelleSalarie(demande)} a été validée par la RH.`,
      lien: `/coordination/dpae/suivi`,
    },
  ]);
}

// motifRejet obligatoire — même exigence que ModaleForcerStatut.jsx pour un forçage de statut :
// un rejet doit toujours porter une raison exploitable par le demandeur.
async function rejeter(entite, demandeId, traitantId, motifRejet) {
  if (!motifRejet || !motifRejet.trim()) {
    throw new Error('Un motif de rejet est obligatoire.');
  }

  const bd = await db.obtenirKnex();
  const demande = await verifierDemandeExiste(bd, entite, demandeId);
  if (demande.statut !== STATUT_ENVOYEE) {
    throw new ErreurDemandeDejaTraitee(`Demande DPAE "${demandeId}" déjà traitée (statut « ${demande.statut} »).`);
  }

  await demandeDpaeRepository.marquerTraitee(bd, demandeId, {
    statut: STATUT_REJETEE,
    traitantId,
    motifRejet: motifRejet.trim(),
  });
  await notificationService.creerNotifications(bd, [
    {
      entiteId: entite.id,
      utilisateurId: demande.demandeur_id,
      type: 'demande_dpae_rejetee',
      tableCible: 'demandes_dpae',
      cibleId: demandeId,
      message: `Votre demande DPAE pour ${libelleSalarie(demande)} a été rejetée par la RH.`,
      lien: `/coordination/dpae/suivi`,
    },
  ]);
}

module.exports = {
  creerEtEnvoyer,
  listerMesDemandes,
  listerPourRh,
  obtenirDemande,
  valider,
  rejeter,
  ErreurDemandeIntrouvable,
  ErreurDemandeDejaTraitee,
};
