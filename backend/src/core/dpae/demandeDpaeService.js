// Orchestration des demandes DPAE — module spécifique à ACCECIT (voir Modularité, CLAUDE.md :
// pas de moteur générique configurable par entité ici, décision actée avec l'utilisateur), même
// découpage repository/service que le reste du projet (voir relanceService.js).

const db = require('../../db/knex');
const demandeDpaeRepository = require('./demandeDpaeRepository');
const notificationService = require('../notifications/notificationService');
const siteAffectationRepository = require('./siteAffectationRepository');
const journalAudit = require('../audit/journalAudit');
const statutsDpae = require('./statutsDpae');
const { champsModifies } = require('./champsDemandeDpae');
const { ROLES } = require('../auth/rbac');
const { aPermission } = require('../auth/permissions');

class ErreurDemandeIntrouvable extends Error {}
// Transition refusée : la demande n'est pas (ou plus) dans un statut qui l'autorise.
class ErreurDemandeDejaTraitee extends Error {}
// Verrouillage optimiste : la demande a changé entre la lecture du client et son écriture.
class ErreurDemandeModifiee extends Error {
  constructor() {
    super('Cette demande a été modifiée entre-temps. Rechargez-la.');
  }
}
// Modification refusée : ni l'auteur de la demande ni un rôle autorisé à modifier celles des autres
// (traduit en 403 par dpae.routes.js).
class ErreurModificationInterdite extends Error {
  constructor() {
    super('Rôle insuffisant pour cette action.');
  }
}
// Site(s) d'affectation inexistant(s), inactif(s) ou d'une autre entité (voir creerEtEnvoyer) —
// traduit en 400 avec son message par dpae.routes.js.
class ErreurSitesAffectationInvalides extends Error {}
// Export PDF groupé : au moins une demande de la sélection hors périmètre — toute la
// requête est refusée (403 dans dpae.routes.js), jamais de ZIP partiel.
class ErreurExportDemandesRefuse extends Error {}

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

// Chaque id doit exister, être actif et appartenir à l'entité : un seul id invalide refuse toute
// la demande (création comme modification) AVANT la moindre écriture.
async function verifierSitesValides(trx, entite, sitesAffectationIds) {
  const idsValides = await siteAffectationRepository.listerIdsSitesValides(trx, entite.id, sitesAffectationIds);
  const idsInvalides = sitesAffectationIds.filter((id) => !idsValides.includes(id));
  if (idsInvalides.length > 0) {
    throw new ErreurSitesAffectationInvalides(
      `Site(s) d'affectation introuvable(s), inactif(s) ou d'une autre entité : ${idsInvalides.join(', ')}. La demande n'a pas été enregistrée.`,
    );
  }
}

// Crée directement la demande (pas de brouillon intermédiaire, voir migration 066). Une demande
// d'un rôle « soumis au Planning » (Inspecteur Hôtellerie) démarre « À valider par le Planning », sans
// date d'envoi à la RH, et les utilisateurs Planning de l'entité en sont notifiés ; toute autre
// démarre « À traiter », envoyée à la RH à l'instant (la RH la voit dans sa file, sans notification
// stockée : voir listerPourRh).
//
// Sites d'affectation (référentiel `sites_affectation`, migration 069) : la demande et ses liens sont
// enregistrés dans UNE SEULE transaction — aucun enregistrement partiel en cas d'erreur. Chaque id
// est d'abord vérifié (existant, actif, de cette entité) ; un seul id invalide refuse toute la
// demande AVANT la moindre écriture. La présence d'au moins un site et l'absence de doublon sont déjà
// garanties par la route (dpae.routes.js, demandeBodySchema).
async function creerEtEnvoyer(entite, demandeurId, donnees, { roleCode } = {}) {
  const bd = await db.obtenirKnex();
  const { sitesAffectationIds = [], ...champsDemande } = donnees;
  const soumiseAuPlanning = aPermission(roleCode, 'dpaeCreationSoumiseAuPlanning');
  return bd.transaction(async (trx) => {
    await verifierSitesValides(trx, entite, sitesAffectationIds);
    const demandeId = await demandeDpaeRepository.creerDemande(trx, {
      ...champsDemande,
      entiteId: entite.id,
      demandeurId,
      statut: soumiseAuPlanning ? statutsDpae.STATUT_A_VALIDER_PLANNING : statutsDpae.STATUT_INITIAL,
    });
    await siteAffectationRepository.lierSitesDemande(trx, demandeId, sitesAffectationIds);
    if (soumiseAuPlanning) {
      await notifierRole(trx, entite, ROLES.PLANNING, demandeId, {
        type: 'demande_dpae_a_valider',
        message: `Nouvelle demande DPAE à valider : ${champsDemande.salariePrenom} ${champsDemande.salarieNom}.`,
      });
    }
    return demandeId;
  });
}

// Notifie tous les comptes actifs d'un rôle de l'entité, avec un lien vers la fiche de la demande.
async function notifierRole(trx, entite, roleCode, demandeId, { type, message }) {
  const ids = await demandeDpaeRepository.listerIdsUtilisateursActifsParRole(trx, entite.id, roleCode);
  await notificationService.creerNotifications(
    trx,
    ids.map((utilisateurId) => ({
      entiteId: entite.id,
      utilisateurId,
      type,
      tableCible: 'demandes_dpae',
      cibleId: demandeId,
      message,
      lien: `/rh/dpae/${demandeId}`,
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// Consultation (périmètre révisé le 2026-09-30, demande utilisateur — voir rbac.js)
// ---------------------------------------------------------------------------------------------

// Périmètre effectif de la liste de suivi : 'toutes' (toutes les demandes de l'entité) ou 'mes'
// (celles dont l'utilisateur est l'auteur). Seuls les rôles de dpaeConsultationToutes
// peuvent obtenir 'toutes' (défaut pour eux) ; pour les autres rôles autorisés à consulter, c'est
// TOUJOURS 'mes', quoi que demande le client. Fonction pure, testable sans base.
function perimetreSuivi({ roleCode, perimetreDemande }) {
  if (!aPermission(roleCode, 'dpaeConsultationToutes')) return 'mes';
  return perimetreDemande === 'mes' ? 'mes' : 'toutes';
}

// Statuts d'avant l'envoi à la RH : invisibles pour un rôle sans dpaeVoitFilePlanning (la RH).
function statutsMasquesPour(roleCode) {
  return aPermission(roleCode, 'dpaeVoitFilePlanning') ? [] : statutsDpae.STATUTS_AVANT_RH;
}

function peutVoirStatut(roleCode, statut) {
  return !statutsMasquesPour(roleCode).includes(statut);
}

// Une fiche est consultable par un rôle qui voit toutes les demandes, ou par son auteur s'il a un
// rôle de consultation. Accueil/Coordination et tout autre rôle : jamais (même auteur d'une demande
// ancienne). L'entité est déjà garantie par la recherche de la demande elle-même (entite_id).
function peutConsulterDemande({ roleCode, utilisateurId, demande }) {
  if (!peutVoirStatut(roleCode, demande.statut)) return false;
  if (aPermission(roleCode, 'dpaeConsultationToutes')) return true;
  return aPermission(roleCode, 'dpaeConsultation') && demande.demandeur_id === utilisateurId;
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
      ? await demandeDpaeRepository.listerDemandesPourRh(bd, entite.id, null, statutsMasquesPour(roleCode))
      : await demandeDpaeRepository.listerDemandesParDemandeur(bd, entite.id, utilisateurId, statutsMasquesPour(roleCode));
  return ajouterSites(bd, demandes);
}

// File des demandes que le Planning doit valider (« À valider par le Planning », puis « Renvoyée à
// l'inspecteur »), sites d'affectation inclus. L'accès (dpaeValidationPlanning) est vérifié par la route.
async function listerAValider(entite) {
  const bd = await db.obtenirKnex();
  return ajouterSites(bd, await demandeDpaeRepository.listerDemandesAValider(bd, entite.id));
}

// statut par défaut : statut initial (file à traiter) — un appelant qui veut l'historique complet
// (traitées incluses) passe explicitement statut=null (voir dpae.routes.js, ?statut=tous).
// Sites d'affectation inclus (2026-10-02 : colonne « Site(s) d'affectation » de la liste RH), même
// forme que listerSuivi.
// La file RH ne contient jamais les demandes encore chez le Planning, même pour l'Admin : elles ont
// leur propre file (listerAValider).
async function listerPourRh(entite, statut = statutsDpae.STATUT_INITIAL) {
  const bd = await db.obtenirKnex();
  const demandes = await demandeDpaeRepository.listerDemandesPourRh(bd, entite.id, statut, statutsDpae.STATUTS_AVANT_RH);
  return ajouterSites(bd, demandes);
}

// sites_affectation : sites liés à la demande, [{ id, nom, initiales }] — vide pour
// une demande antérieure au référentiel, dont l'affichage retombe alors sur l'ancien texte `hotel`
// (voir DetailDemandeDpae.jsx).
async function obtenirDemande(entite, demandeId) {
  const bd = await db.obtenirKnex();
  const demande = await verifierDemandeExiste(bd, entite, demandeId);
  const sitesAffectation = await siteAffectationRepository.listerSitesDemande(bd, demandeId);
  return { ...demande, sites_affectation: sitesAffectation };
}

// Demandes d'un export PDF groupé (ZIP, 2026-10-02) — MÊMES règles que la fiche (GET /:id) :
// demande de l'entité courante (obtenirDemande) ET consultable par l'utilisateur
// (peutConsulterDemande). Une seule demande hors périmètre (autre entité, inexistante ou non
// consultable) fait échouer TOUTE la sélection : ErreurExportDemandesRefuse, rien n'est renvoyé.
// Lectures séquentielles (50 demandes au plus, voir dpae.routes.js) plutôt qu'un Promise.all.
// Appels via module.exports : remplaçables par les tests.
async function obtenirDemandesPourExport(entite, demandeIds, { roleCode, utilisateurId }) {
  const demandes = [];
  for (const demandeId of demandeIds) {
    let demande;
    try {
       
      demande = await module.exports.obtenirDemande(entite, demandeId);
    } catch (erreur) {
      if (erreur instanceof ErreurDemandeIntrouvable) {
        throw new ErreurExportDemandesRefuse(`Demande DPAE n° ${demandeId} hors de votre périmètre : aucun fichier n'a été généré.`);
      }
      throw erreur;
    }
    if (!module.exports.peutConsulterDemande({ roleCode, utilisateurId, demande })) {
      throw new ErreurExportDemandesRefuse(`Demande DPAE n° ${demandeId} hors de votre périmètre : aucun fichier n'a été généré.`);
    }
    demandes.push(demande);
  }
  return demandes;
}

// Applique une transition de statut (valider, rejeter, mettre en attente) dans UNE SEULE
// transaction : lecture, vérifications, écriture gardée, journal d'audit et notifications — si
// l'une échoue, rien n'est enregistré.
//   0. visibilité : `roleCode` doit pouvoir voir le statut de la demande, sinon ErreurModificationInterdite
//      (403) ;
//   1. version : celle que le client a lue doit être la version courante, sinon ErreurDemandeModifiee ;
//   2. transition : (action, statut courant) doit figurer dans la table de statutsDpae.js, sinon
//      ErreurDemandeDejaTraitee ;
//   3. écriture gardée par statut ET version : si une décision concurrente est passée entre la lecture
//      et l'écriture, aucune ligne n'est modifiée -> ErreurDemandeModifiee.
// `ecrire(trx, demande, transition)` renvoie le nombre de lignes modifiées ; `tracer` décrit l'audit
// et `notifier(demande, trx)` renvoie les notifications de l'action, [{ utilisateurId, type, message,
// lien }].
async function appliquerTransition(entite, demandeId, { action, version, utilisateurId, roleCode, adresseIp, ecrire, tracer, notifier }) {
  if (!Number.isInteger(version)) {
    throw new Error('La version de la demande est obligatoire.');
  }

  const bd = await db.obtenirKnex();
  return bd.transaction(async (trx) => {
    const demande = await verifierDemandeExiste(trx, entite, demandeId);
    // Une demande que le rôle n'a pas le droit de voir (la RH, avant l'envoi à la RH) : refus 403
    // identique à la consultation, avant toute autre vérification — aucune information sur le statut.
    if (!peutVoirStatut(roleCode, demande.statut)) throw new ErreurModificationInterdite();
    if (demande.version !== version) throw new ErreurDemandeModifiee();

    const transition = statutsDpae.trouverTransition(action, demande.statut);
    if (!transition) {
      throw new ErreurDemandeDejaTraitee(
        `Demande DPAE "${demandeId}" : action « ${action} » impossible depuis le statut « ${demande.statut} ».`,
      );
    }

    const lignesModifiees = await ecrire(trx, demande, transition);
    if (lignesModifiees !== 1) throw new ErreurDemandeModifiee();

    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      tableCible: 'demandes_dpae',
      cibleId: demandeId,
      adresseIp,
      ...tracer,
    });
    const notifications = await notifier(demande, trx);
    await notificationService.creerNotifications(
      trx,
      notifications.map((notification) => ({ entiteId: entite.id, tableCible: 'demandes_dpae', cibleId: demandeId, ...notification })),
    );
  });
}

// Notification du seul demandeur, vers sa liste de suivi (décisions de la RH).
const versDemandeur = (type, messageDe) => (demande) => [
  { utilisateurId: demande.demandeur_id, type, message: messageDe(demande), lien: '/coordination/dpae/suivi' },
];

// `version` : version de la demande lue par l'appelant (verrouillage optimiste, voir
// appliquerTransition). `adresseIp` : tracée dans journal_audit.
async function valider(entite, demandeId, traitantId, { version, adresseIp, roleCode } = {}) {
  return appliquerTransition(entite, demandeId, {
    action: statutsDpae.ACTION_VALIDER,
    version,
    roleCode,
    utilisateurId: traitantId,
    adresseIp,
    ecrire: (trx, demande, transition) =>
      demandeDpaeRepository.marquerTraitee(trx, demandeId, {
        statutDepart: demande.statut,
        version: demande.version,
        statut: transition.vers,
        traitantId,
      }),
    tracer: { action: 'demande_dpae_validation', donnees: {} },
    notifier: versDemandeur('demande_dpae_validee', (demande) => `Votre demande DPAE pour ${libelleSalarie(demande)} a été validée par la RH.`),
  });
}

// motifRejet obligatoire — même exigence que ModaleForcerStatut.jsx pour un forçage de statut :
// un rejet doit toujours porter une raison exploitable par le demandeur.
async function rejeter(entite, demandeId, traitantId, motifRejet, { version, adresseIp, roleCode } = {}) {
  if (!motifRejet || !motifRejet.trim()) {
    throw new Error('Un motif de rejet est obligatoire.');
  }
  const motif = motifRejet.trim();

  return appliquerTransition(entite, demandeId, {
    action: statutsDpae.ACTION_REJETER,
    version,
    roleCode,
    utilisateurId: traitantId,
    adresseIp,
    ecrire: (trx, demande, transition) =>
      demandeDpaeRepository.marquerTraitee(trx, demandeId, {
        statutDepart: demande.statut,
        version: demande.version,
        statut: transition.vers,
        traitantId,
        motifRejet: motif,
      }),
    tracer: { action: 'demande_dpae_rejet', donnees: { motifRejet: motif } },
    notifier: versDemandeur('demande_dpae_rejetee', (demande) => `Votre demande DPAE pour ${libelleSalarie(demande)} a été rejetée par la RH : ${motif}`),
  });
}

// Mise en attente : motif obligatoire, conservé sur la demande (dernier motif, affiché sur la
// fiche) ; le demandeur est notifié. N'est pas une décision : date de traitement inchangée (voir
// demandeDpaeRepository.marquerEnAttente). Les statuts de départ autorisés sont ceux de la table
// de transitions (statutsDpae.js).
async function mettreEnAttente(entite, demandeId, traitantId, motif, { version, adresseIp, roleCode } = {}) {
  if (!motif || !motif.trim()) {
    throw new Error('Un motif de mise en attente est obligatoire.');
  }
  const motifNettoye = motif.trim();

  return appliquerTransition(entite, demandeId, {
    action: statutsDpae.ACTION_METTRE_EN_ATTENTE,
    version,
    roleCode,
    utilisateurId: traitantId,
    adresseIp,
    ecrire: (trx, demande) =>
      demandeDpaeRepository.marquerEnAttente(trx, demandeId, {
        statutDepart: demande.statut,
        version: demande.version,
        traitantId,
        motif: motifNettoye,
      }),
    tracer: { action: 'demande_dpae_mise_en_attente', donnees: { motif: motifNettoye } },
    notifier: versDemandeur(
      'demande_dpae_en_attente',
      (demande) => `Votre demande DPAE pour ${libelleSalarie(demande)} a été mise en attente par la RH : ${motifNettoye}`,
    ),
  });
}

// Transmission à la RH par le Planning (ou l'Admin) : date_envoi_rh posée, la RH et l'inspecteur
// auteur sont notifiés.
async function transmettreALaRh(entite, demandeId, utilisateurId, { version, adresseIp, roleCode } = {}) {
  return appliquerTransition(entite, demandeId, {
    action: statutsDpae.ACTION_TRANSMETTRE_RH,
    version,
    roleCode,
    utilisateurId,
    adresseIp,
    ecrire: (trx, demande, transition) =>
      demandeDpaeRepository.transmettreALaRh(trx, demandeId, { statutDepart: demande.statut, version: demande.version, statut: transition.vers }),
    tracer: { action: 'demande_dpae_transmission_rh', donnees: {} },
    notifier: async (demande, trx) => {
      const rhIds = await demandeDpaeRepository.listerIdsUtilisateursActifsParRole(trx, entite.id, ROLES.RH);
      return [
        ...rhIds.map((rhId) => ({
          utilisateurId: rhId,
          type: 'demande_dpae_transmise',
          message: `Nouvelle demande DPAE à traiter : ${libelleSalarie(demande)}.`,
          lien: `/rh/dpae/${demandeId}`,
        })),
        {
          utilisateurId: demande.demandeur_id,
          type: 'demande_dpae_transmise',
          message: `Votre demande DPAE pour ${libelleSalarie(demande)} a été transmise à la RH par le Planning.`,
          lien: `/rh/dpae/${demandeId}`,
        },
      ];
    },
  });
}

// Renvoi à l'inspecteur auteur : motif obligatoire, conservé sur la demande et repris dans la
// notification.
async function renvoyerAInspecteur(entite, demandeId, utilisateurId, motif, { version, adresseIp, roleCode } = {}) {
  if (!motif || !motif.trim()) {
    throw new Error('Un motif de renvoi est obligatoire.');
  }
  const motifNettoye = motif.trim();

  return appliquerTransition(entite, demandeId, {
    action: statutsDpae.ACTION_RENVOYER_INSPECTEUR,
    version,
    roleCode,
    utilisateurId,
    adresseIp,
    ecrire: (trx, demande, transition) =>
      demandeDpaeRepository.renvoyerAInspecteur(trx, demandeId, {
        statutDepart: demande.statut,
        version: demande.version,
        statut: transition.vers,
        motif: motifNettoye,
      }),
    tracer: { action: 'demande_dpae_renvoi_inspecteur', donnees: { motif: motifNettoye } },
    notifier: (demande) => [
      {
        utilisateurId: demande.demandeur_id,
        type: 'demande_dpae_renvoyee',
        message: `Votre demande DPAE pour ${libelleSalarie(demande)} vous a été renvoyée par le Planning : ${motifNettoye}`,
        lien: `/rh/dpae/${demandeId}`,
      },
    ],
  });
}

// Modification : l'auteur de la demande (s'il a un rôle autorisé à modifier) ou un rôle qui peut
// modifier celles de tous les auteurs (Planning, Admin). L'entité est déjà garantie par la
// recherche de la demande elle-même (entite_id). Fonction pure, testable sans base.
function peutModifierDemande({ roleCode, utilisateurId, demande }) {
  if (aPermission(roleCode, 'dpaeModificationToutes')) return true;
  return aPermission(roleCode, 'dpaeModification') && demande.demandeur_id === utilisateurId;
}

// Modifie une demande non décidée (transition « modifier » de statutsDpae.js : « À traiter » reste
// « À traiter », « En attente » repasse « À traiter » et la RH est notifiée, « Renvoyée à
// l'inspecteur » repasse « À valider par le Planning » et le Planning est notifié ; « À valider par le
// Planning » reste tel quel), dans UNE SEULE transaction : demande, sites d'affectation, journal d'audit et
// notifications. Ordre des refus : introuvable (404) -> droit (403) -> version obsolète ou demande
// modifiée entre-temps (409) -> statut verrouillé (409) -> sites invalides (400). Le demandeur,
// l'entité et la date de création ne sont jamais modifiés. `donnees` : la demande complète, déjà
// validée par le même schéma que la création (dpae.routes.js).
// Un enregistrement sans aucun changement n'écrit rien (ni version, ni audit, ni notification, ni
// changement de statut) et le signale par `aucuneModification`.
// Trace : statut avant/après et NOMS des champs modifiés, jamais leurs valeurs (données
// personnelles).
async function modifierDemande(entite, demandeId, { donnees, version, utilisateurId, roleCode, adresseIp }) {
  if (!Number.isInteger(version)) {
    throw new Error('La version de la demande est obligatoire.');
  }
  const { sitesAffectationIds = [], ...champsDemande } = donnees;

  const bd = await db.obtenirKnex();
  return bd.transaction(async (trx) => {
    const demande = await verifierDemandeExiste(trx, entite, demandeId);
    if (!module.exports.peutModifierDemande({ roleCode, utilisateurId, demande })) throw new ErreurModificationInterdite();
    if (demande.version !== version) throw new ErreurDemandeModifiee();

    const transition = statutsDpae.trouverTransition(statutsDpae.ACTION_MODIFIER, demande.statut);
    if (!transition) {
      throw new ErreurDemandeDejaTraitee(`Demande DPAE "${demandeId}" déjà traitée (statut « ${demande.statut} ») : elle n'est plus modifiable.`);
    }

    await verifierSitesValides(trx, entite, sitesAffectationIds);
    const anciensSites = (await siteAffectationRepository.listerSitesDemande(trx, demandeId)).map((site) => site.id);
    const sitesModifies = anciensSites.length !== sitesAffectationIds.length || anciensSites.some((id) => !sitesAffectationIds.includes(id));
    const champs = [...champsModifies(demande, champsDemande), ...(sitesModifies ? ['sitesAffectationIds'] : [])];
    if (champs.length === 0) {
      return { statut: demande.statut, version: demande.version, champsModifies: [], aucuneModification: true };
    }

    const lignesModifiees = await demandeDpaeRepository.modifierDemande(trx, demandeId, {
      statutDepart: demande.statut,
      version: demande.version,
      statutArrivee: transition.vers,
      donnees: champsDemande,
    });
    if (lignesModifiees !== 1) throw new ErreurDemandeModifiee();
    await siteAffectationRepository.remplacerSitesDemande(trx, demandeId, sitesAffectationIds);

    await journalAudit.enregistrerAction(trx, {
      utilisateurId,
      entiteId: entite.id,
      action: 'demande_dpae_modification',
      tableCible: 'demandes_dpae',
      cibleId: demandeId,
      donnees: { statutAvant: demande.statut, statutApres: transition.vers, champsModifies: champs },
      adresseIp,
    });

    // « Renvoyée » -> « À valider par le Planning » : le Planning est prévenu de la correction.
    if (demande.statut === statutsDpae.STATUT_RENVOYEE_INSPECTEUR) {
      await notifierRole(trx, entite, ROLES.PLANNING, demandeId, {
        type: 'demande_dpae_corrigee',
        message: `Demande DPAE corrigée par l'inspecteur, à valider : ${champsDemande.salariePrenom} ${champsDemande.salarieNom}.`,
      });
    } else if (demande.statut !== transition.vers) {
      // « En attente » -> « À traiter » : la RH, qui avait suspendu la demande, est prévenue qu'elle
      // est complétée. Une demande « À traiter » modifiée reste dans la file sans notification.
      const rhIds = await demandeDpaeRepository.listerIdsUtilisateursActifsParRole(trx, entite.id, ROLES.RH);
      await notificationService.creerNotifications(
        trx,
        rhIds.map((rhId) => ({
          entiteId: entite.id,
          utilisateurId: rhId,
          type: 'demande_dpae_completee',
          tableCible: 'demandes_dpae',
          cibleId: demandeId,
          message: `Demande complétée : la demande DPAE pour ${champsDemande.salariePrenom} ${champsDemande.salarieNom} a été modifiée et repasse « À traiter ».`,
          lien: `/rh/dpae/${demandeId}`,
        })),
      );
    }

    return { statut: transition.vers, version: demande.version + 1, champsModifies: champs };
  });
}

module.exports = {
  creerEtEnvoyer,
  perimetreSuivi,
  statutsMasquesPour,
  peutVoirStatut,
  peutConsulterDemande,
  peutModifierDemande,
  modifierDemande,
  listerSuivi,
  listerPourRh,
  listerAValider,
  obtenirDemande,
  obtenirDemandesPourExport,
  valider,
  rejeter,
  mettreEnAttente,
  transmettreALaRh,
  renvoyerAInspecteur,
  ErreurDemandeIntrouvable,
  ErreurDemandeDejaTraitee,
  ErreurDemandeModifiee,
  ErreurModificationInterdite,
  ErreurSitesAffectationInvalides,
  ErreurExportDemandesRefuse,
};
