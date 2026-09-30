// Orchestration des demandes DPAE — module spécifique à ACCECIT (voir Modularité, CLAUDE.md :
// pas de moteur générique configurable par entité ici, décision actée avec l'utilisateur), même
// découpage repository/service que le reste du projet (voir relanceService.js).

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');
const siteAffectationRepository = require('./siteAffectationRepository');
const { ROLES_DPAE_CONSULTATION, ROLES_DPAE_CONSULTATION_TOUTES } = require('../auth/rbac');

const STATUT_ENVOYEE = 'envoyee';
const STATUT_VALIDEE = 'validee';
const STATUT_REJETEE = 'rejetee';

class ErreurDemandeIntrouvable extends Error {}
class ErreurDemandeDejaTraitee extends Error {}
// Site(s) d'affectation inexistant(s), inactif(s) ou d'une autre entité (voir creerEtEnvoyer) —
// traduit en 400 avec son message par dpae.routes.js.
class ErreurSitesAffectationInvalides extends Error {}

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
//
// Sites d'affectation (2026-09-29, référentiel `sites_affectation`, migration 069) : la demande et
// ses liens sont enregistrés dans UNE SEULE transaction — aucun enregistrement partiel en cas
// d'erreur. Chaque id est d'abord vérifié (existant, actif, de cette entité) ; un seul id invalide
// refuse toute la demande AVANT la moindre écriture. La présence d'au moins un site et l'absence de
// doublon sont déjà garanties par la route (dpae.routes.js, demandeBodySchema).
async function creerEtEnvoyer(entite, demandeurId, donnees) {
  const bd = await db.obtenirKnex();
  const { sitesAffectationIds = [], ...champsDemande } = donnees;
  return bd.transaction(async (trx) => {
    const idsValides = await siteAffectationRepository.listerIdsSitesValides(trx, entite.id, sitesAffectationIds);
    const idsInvalides = sitesAffectationIds.filter((id) => !idsValides.includes(id));
    if (idsInvalides.length > 0) {
      throw new ErreurSitesAffectationInvalides(
        `Site(s) d'affectation introuvable(s), inactif(s) ou d'une autre entité : ${idsInvalides.join(', ')}. La demande n'a pas été enregistrée.`,
      );
    }
    const demandeId = await demandeDpaeRepository.creerDemande(trx, {
      ...champsDemande,
      entiteId: entite.id,
      demandeurId,
    });
    await siteAffectationRepository.lierSitesDemande(trx, demandeId, sitesAffectationIds);
    return demandeId;
  });
}

// ---------------------------------------------------------------------------------------------
// Consultation (périmètre révisé le 2026-09-30, demande utilisateur — voir rbac.js)
// ---------------------------------------------------------------------------------------------

// Périmètre effectif de la liste de suivi : 'toutes' (toutes les demandes de l'entité) ou 'mes'
// (celles dont l'utilisateur est l'auteur). Seuls les rôles de ROLES_DPAE_CONSULTATION_TOUTES
// peuvent obtenir 'toutes' (défaut pour eux) ; pour les autres rôles autorisés à consulter, c'est
// TOUJOURS 'mes', quoi que demande le client. Fonction pure, testable sans base.
function perimetreSuivi({ roleCode, perimetreDemande }) {
  if (!ROLES_DPAE_CONSULTATION_TOUTES.includes(roleCode)) return 'mes';
  return perimetreDemande === 'mes' ? 'mes' : 'toutes';
}

// Une fiche est consultable par un rôle qui voit toutes les demandes, ou par son auteur s'il a un
// rôle de consultation. Accueil/Coordination et tout autre rôle : jamais (même auteur d'une demande
// ancienne). L'entité est déjà garantie par la recherche de la demande elle-même (entite_id).
function peutConsulterDemande({ roleCode, utilisateurId, demande }) {
  if (ROLES_DPAE_CONSULTATION_TOUTES.includes(roleCode)) return true;
  return ROLES_DPAE_CONSULTATION.includes(roleCode) && demande.demandeur_id === utilisateurId;
}

// Ajoute à chaque demande ses sites liés ([{ id, nom, initiales }], triés par nom) — tableau vide
// pour une demande antérieure au référentiel, dont l'affichage retombe alors sur l'ancien texte
// `hotel`. Une seule requête pour toute la liste (pas une par demande).
async function ajouterSites(bd, demandes) {
  const liens = await siteAffectationRepository.listerSitesParDemandes(
    bd,
    demandes.map((demande) => demande.id),
  );
  return demandes.map((demande) => ({
    ...demande,
    sites_affectation: liens
      .filter((lien) => lien.demande_dpae_id === demande.id)
      .map(({ id, nom, initiales }) => ({ id, nom, initiales })),
  }));
}

// Liste de suivi (« Suivi des demandes DPAE ») — toujours limitée à l'entité courante, plus récentes
// d'abord, tous statuts. `perimetre` résolu par perimetreSuivi ci-dessus.
async function listerSuivi(entite, { utilisateurId, roleCode, perimetreDemande }) {
  const bd = await db.obtenirKnex();
  const perimetre = perimetreSuivi({ roleCode, perimetreDemande });
  const demandes =
    perimetre === 'toutes'
      ? await demandeDpaeRepository.listerDemandesPourRh(bd, entite.id, null)
      : await demandeDpaeRepository.listerDemandesParDemandeur(bd, entite.id, utilisateurId);
  return ajouterSites(bd, demandes);
}

// statut par défaut 'envoyee' (file à traiter) — un appelant qui veut l'historique complet
// (traitées incluses) passe explicitement statut=null (voir dpae.routes.js, ?statut=tous).
async function listerPourRh(entite, statut = STATUT_ENVOYEE) {
  const bd = await db.obtenirKnex();
  return demandeDpaeRepository.listerDemandesPourRh(bd, entite.id, statut);
}

// sites_affectation (2026-09-29) : sites liés à la demande, [{ id, nom, initiales }] — vide pour
// une demande antérieure au référentiel, dont l'affichage retombe alors sur l'ancien texte `hotel`
// (voir DetailDemandeDpae.jsx).
async function obtenirDemande(entite, demandeId) {
  const bd = await db.obtenirKnex();
  const demande = await verifierDemandeExiste(bd, entite, demandeId);
  const sitesAffectation = await siteAffectationRepository.listerSitesDemande(bd, demandeId);
  return { ...demande, sites_affectation: sitesAffectation };
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
  perimetreSuivi,
  peutConsulterDemande,
  listerSuivi,
  listerPourRh,
  obtenirDemande,
  valider,
  rejeter,
  ErreurDemandeIntrouvable,
  ErreurDemandeDejaTraitee,
  ErreurSitesAffectationInvalides,
};
