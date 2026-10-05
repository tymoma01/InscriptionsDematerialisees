const { Router } = require('express');
const { z } = require('zod');
// archiver@8 : ESM pur, constructeur ZipArchive — même import que l'export ZIP des pièces
// (pieces.routes.js, voir son commentaire).
const { ZipArchive } = require('archiver');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const notesDemandeDpaeService = require('../../core/dpae/notesDemandeDpaeService');
const tableauDeBordDpaeService = require('../../core/dpae/tableauDeBordDpaeService');
const pdfDemandeDpae = require('../../core/dpae/pdfDemandeDpae');
const statutsDpae = require('../../core/dpae/statutsDpae');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requirePermission } = require('../middlewares/rbac.middleware');

// Monté sur '/api/dpae' (voir app.js) — module spécifique à ACCECIT (voir Modularité, CLAUDE.md :
// pas de moteur générique configurable par entité ici, décision actée avec l'utilisateur).
const router = Router();

router.use(requireAuth);

const idPositifSchema = z.coerce.number().int().positive();

// Un <select> non renseigné (DemandeDpae.jsx) envoie '' plutôt que d'omettre le champ — z.enum
// seul rejetterait cette chaîne vide comme valeur invalide (elle n'appartient pas à l'énumération)
// au lieu de la traiter comme "non renseigné" : ce préprocesseur convertit '' en undefined avant
// validation, pour que .optional() s'applique réellement.
function enumOptionnel(valeurs) {
  return z.preprocess((valeur) => (valeur === '' ? undefined : valeur), z.enum(valeurs).optional());
}

// Champs d'une demande, SANS les règles croisées : source unique de la création (POST /) et de la
// modification (PUT /:id), qui y ajoutent chacune leurs propres champs (version) et les mêmes
// règles croisées (verifierReglesDemande).
const demandeBaseSchema = z.object({
  typeDemande: z.enum([
    'nouvelle_embauche',
    'prolongation',
    'ajout_retrait_jours',
    'passage_cdi',
    'changement_horaires_affectation',
  ]),
  salarieNom: z.string().trim().min(1),
  salariePrenom: z.string().trim().min(1),
  salarieTelephone: z.string().trim().optional(),
  salarieDejaEmploye: z.boolean(),
  candidatId: idPositifSchema.optional(),
  // Ancien champ texte libre "Site d'affectation" (colonne `hotel`, migration 068) — REMPLACÉ le
  // 2026-09-29 par sitesAffectationIds ci-dessous (référentiel, migration 069). Plus envoyé par le
  // formulaire ; toléré s'il est fourni (facultatif), la colonne restant en base pour les demandes
  // antérieures, dont l'affichage retombe dessus (voir DetailDemandeDpae.jsx).
  hotel: z.string().trim().optional(),
  // Site(s) d'affectation : liste OBLIGATOIRE d'ids du référentiel
  // `sites_affectation`, au moins un, sans doublon. Absente -> même refus qu'une liste vide
  // (preprocess). L'existence, l'état actif et l'appartenance à l'entité de chaque id sont vérifiés
  // par demandeDpaeService.creerEtEnvoyer, dans la transaction qui enregistre la demande.
  sitesAffectationIds: z.preprocess(
    (valeur) => valeur ?? [],
    z
      .array(idPositifSchema)
      .min(1, "Au moins un site d'affectation est obligatoire.")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Un même site d'affectation ne peut pas être sélectionné deux fois.",
      }),
  ),
  typeContrat: enumOptionnel(['cdd', 'cdi']),
  motifCdd: enumOptionnel(['remplacement_absent', 'surcroit_activite']),
  salarieRemplaceNom: z.string().trim().optional(),
  dateFinAbsence: z.string().trim().optional(),
  raisonSurcroit: z.string().trim().optional(),
  division: enumOptionnel(['acchot', 'rm', 'autre']),
  divisionAutre: z.string().trim().optional(),
  poste: z.string().trim().optional(),
  posteAutre: z.string().trim().optional(),
  // Premier jour : obligatoire pour tous les types de demande (le formulaire l'affiche sans
  // distinction de typeDemande, voir DemandeDpae.jsx) — absent ou vide refusé avec le même
  // message que côté front.
  dateDebut: z.preprocess((valeur) => valeur ?? '', z.string().trim().min(1, 'Le premier jour est obligatoire.')),
  dateFin: z.string().trim().optional(),
  heureArriveeJ1: z.string().trim().optional(),
  heuresParMois: z.number().nonnegative().optional(),
  modificationsDemandees: z.boolean().optional(),
  modificationHoraires: z.boolean().optional(),
  modificationJoursRepos: z.boolean().optional(),
  modificationAffectation: z.boolean().optional(),
  nouvelleAffectation: z.string().trim().optional(),
  typeChangementJours: enumOptionnel(['ajouter', 'retirer']),
  // Forme libre côté back (validée en détail côté front, formulaire) : un tableau de {date,
  // action} — même choix que dossier_donnees_formulaire.donnees, jamais un schéma zod strict par
  // champ imbriqué (voir migration 013 et son commentaire).
  joursConcernes: z.array(z.record(z.string(), z.unknown())).optional(),
  raisonChangementJours: z.string().trim().optional(),
  raisonIdentiqueContrat: enumOptionnel(['oui', 'non', 'ne_sais_pas']),
  semaineType: z.array(z.record(z.string(), z.unknown())).optional(),
  horairesDifferentsParJour: z.boolean().optional(),
  autreChoseSignaler: z.string().trim().optional(),
  verifBesoinHotel: z.boolean(),
  verifTousJoursInclus: z.boolean(),
  verifNonPlanification: z.boolean(),
});

// Règles croisées entre champs, communes à la création et à la modification.
// "Nom du salarié remplacé" obligatoire UNIQUEMENT pour un CDD de remplacement (audit 2026-09-29,
// demande utilisateur) — règle croisée entre champs, d'où ce contrôle ici plutôt qu'un min(1) sur
// le champ lui-même (qui l'imposerait dans tous les cas). salarieRemplaceNom est déjà trimé
// ci-dessus : une saisie faite d'espaces arrive ici vide et est refusée. Aucun contrôle pour un
// CDI ou un CDD de surcroît d'activité. La date de fin d'absence reste facultative (demande
// explicite). Colonne inchangée en base, demandes existantes non concernées.
function verifierReglesDemande(demande, ctx) {
  if (demande.typeContrat === 'cdd' && demande.motifCdd === 'remplacement_absent' && !demande.salarieRemplaceNom) {
    ctx.addIssue({
      code: 'custom',
      path: ['salarieRemplaceNom'],
      message: 'Le nom du salarié remplacé est obligatoire pour un CDD de remplacement.',
    });
  }
}

// Création : la demande complète.
const demandeBodySchema = demandeBaseSchema.superRefine(verifierReglesDemande);

// Version de la demande lue par le client (verrouillage optimiste, voir
// demandeDpaeService.appliquerTransition et modifierDemande) : absente ou invalide -> 400.
const versionSchema = z.coerce.number().int().positive();

// Modification (PUT /:id) : la demande COMPLÈTE (mêmes champs et mêmes règles que la création) plus
// la version lue. Le demandeur, l'entité, la date de création et le statut ne figurent pas dans le
// schéma : un client qui les enverrait serait ignoré.
const modificationBodySchema = demandeBaseSchema.extend({ version: versionSchema }).superRefine(verifierReglesDemande);

// Chaque décision porte la version de la demande lue par le client : absente ou invalide -> 400.
const validationBodySchema = z.object({ version: versionSchema });

const rejetBodySchema = z.object({
  motifRejet: z.string().trim().min(1, 'Un motif de rejet est obligatoire.'),
  version: versionSchema,
});

// Mise en attente : motif OBLIGATOIRE — absent, vide ou fait d'espaces -> 400.
const miseEnAttenteBodySchema = z.object({
  motif: z.string().trim().min(1, 'Un motif de mise en attente est obligatoire.'),
  version: versionSchema,
});

// Réponses d'erreur communes aux décisions et à la modification : demande d'une autre entité ou
// inexistante 404, droit insuffisant 403, transition non autorisée depuis le statut courant ou
// demande modifiée entre-temps 409, corps ou sites invalides 400. Renvoie true si l'erreur a été traitée.
function repondreErreurDecision(res, erreur) {
  if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
    res.status(404).json({ erreur: erreur.message });
    return true;
  }
  if (erreur instanceof demandeDpaeService.ErreurDemandeDejaTraitee || erreur instanceof demandeDpaeService.ErreurDemandeModifiee) {
    res.status(409).json({ erreur: erreur.message });
    return true;
  }
  if (erreur instanceof demandeDpaeService.ErreurModificationInterdite) {
    res.status(403).json({ erreur: erreur.message });
    return true;
  }
  if (erreur instanceof demandeDpaeService.ErreurSitesAffectationInvalides) {
    res.status(400).json({ erreur: erreur.message });
    return true;
  }
  if (erreur instanceof z.ZodError) {
    repondreErreurValidation(res, erreur);
    return true;
  }
  return false;
}

// Notes d'une demande DPAE : mêmes règles que les notes d'un dossier (notes.routes.js).
const noteBodySchema = z.object({
  contenu: z.string().trim().min(1).max(1000),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// POST /api/dpae — crée une demande et l'envoie directement à la RH (pas de brouillon, voir
// demandeDpaeService.creerEtEnvoyer). utilisateurId toujours pris de la session, jamais du corps
// de la requête — même principe que relances.routes.js.
router.post('/', requirePermission('dpaeCreation'), async (req, res, next) => {
  try {
    const donnees = demandeBodySchema.parse(req.body);
    const demandeId = await demandeDpaeService.creerEtEnvoyer(req.entite, req.utilisateur.id, donnees);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'demande_dpae_creation',
      tableCible: 'demandes_dpae',
      cibleId: demandeId,
      donnees: { typeDemande: donnees.typeDemande, sitesAffectationIds: donnees.sitesAffectationIds },
      adresseIp: req.ip,
    });

    res.status(201).json({ demandeId });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    // Site inexistant, inactif ou d'une autre entité : refus de toute la demande (rien n'a été
    // enregistré, voir demandeDpaeService.creerEtEnvoyer), message explicite plutôt qu'un 500.
    if (erreur instanceof demandeDpaeService.ErreurSitesAffectationInvalides) {
      return res.status(400).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

// GET /api/dpae/suivi?perimetre=toutes|mes — page « Suivi des demandes DPAE » (remplace
// GET /mes-demandes le 2026-09-30, qui ne renvoyait que les demandes de l'utilisateur connecté :
// d'où la liste vide constatée pour un Admin qui n'en avait créé aucune). Tous statuts, plus
// récentes d'abord, sites d'affectation inclus, entité courante uniquement. Périmètre résolu côté
// serveur (demandeDpaeService.perimetreSuivi) : 'toutes' par défaut pour Admin, RH et Planning
// (dpaeConsultationToutes), 'mes' sur demande. Accueil/Coordination : 403.
router.get('/suivi', requirePermission('dpaeConsultation'), async (req, res, next) => {
  try {
    const demandes = await demandeDpaeService.listerSuivi(req.entite, {
      utilisateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
      perimetreDemande: req.query.perimetre,
    });
    res.json(demandes);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dpae/tableau-de-bord — « Tableau de bord DPAE ». Indicateurs calculés en
// base, entité courante uniquement (tableauDeBordDpaeService / tableauDeBordDpaeRepository). Accès
// Admin, RH, Planning (dpaeConsultation) ; 403 pour tout autre rôle. Déclarée AVANT
// GET /:id : sinon « tableau-de-bord » serait pris pour un identifiant de demande.
// Filtres (tous optionnels) : debut/fin (AAAA-MM-JJ, jours parisiens de création ; défaut : les 30
// derniers jours), siteId (id d'un site, ou 'non_reference' pour les anciennes demandes sans site
// lié), typeContrat (cdd|cdi), statut (un des statuts de statutsDpae.js). Une valeur vide vaut
// « tous ».
const videVersIndefini = (valeur) => (valeur === '' ? undefined : valeur);
const filtresTableauDeBordSchema = z.object({
  debut: z.preprocess(videVersIndefini, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  fin: z.preprocess(videVersIndefini, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  siteId: z.preprocess(videVersIndefini, z.union([z.literal('non_reference'), idPositifSchema]).optional()),
  typeContrat: enumOptionnel(['cdd', 'cdi']),
  statut: enumOptionnel(statutsDpae.CODES_STATUTS_DPAE),
});

// dpaeTableauDeBord : Admin, RH, Planning — l'Inspecteur Hôtellerie, bien que
// dans dpaeConsultation, n'a pas le tableau de bord DPAE.
router.get('/tableau-de-bord', requirePermission('dpaeTableauDeBord'), async (req, res, next) => {
  try {
    const filtres = filtresTableauDeBordSchema.parse(req.query);
    res.json(await tableauDeBordDpaeService.calculerTableauDeBord(req.entite, filtres));
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof tableauDeBordDpaeService.ErreurFiltresTableauDeBord) {
      return res.status(400).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

// Téléchargement PDF groupé : 50 demandes au plus par ZIP. Miroir côté front :
// frontend/src/core/dpae/telechargementPdfDpae.js (même limite, pour prévenir avant l'envoi).
const LIMITE_DEMANDES_PAR_ZIP = 50;
const exportPdfBodySchema = z.object({
  demandeIds: z.array(idPositifSchema).min(1, 'Sélectionnez au moins une demande.'),
});

// Date du jour (Paris) pour le nom du ZIP, sans "/" (interdit dans un nom de fichier) : JJ-MM-AAAA.
function dateDuJourPourNomFichier(maintenant = new Date()) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Paris' })
    .format(maintenant)
    .replace(/\//g, '-');
}

// POST /api/dpae/export-pdf { demandeIds: [..] } — ZIP contenant un PDF par demande
// (« DPAE <n°> - <NOM> <Prénom>.pdf »), nommé « Demandes DPAE - <date du jour>.zip ». MÊMES règles
// d'accès que la fiche (GET /:id) : même garde de rôle (dpaeConsultation) puis, pour CHAQUE
// demande, entité courante et peutConsulterDemande (demandeDpaeService.obtenirDemandesPourExport).
// Une seule demande hors périmètre -> 403 pour toute la requête, aucun ZIP (même partiel). Au-delà
// de 50 demandes -> 400 avec un message explicite. Toutes les vérifications et tous les PDF sont
// faits AVANT l'envoi des en-têtes : une erreur à ce stade donne une réponse d'erreur propre.
// Tracé dans journal_audit comme l'export ZIP des pièces (pieces_justificatives_export_zip).
router.post('/export-pdf', requirePermission('dpaeConsultation'), async (req, res, next) => {
  try {
    const { demandeIds: demandeIdsRecus } = exportPdfBodySchema.parse(req.body);
    // Un même identifiant envoyé deux fois ne produit qu'un fichier.
    const demandeIds = [...new Set(demandeIdsRecus)];
    if (demandeIds.length > LIMITE_DEMANDES_PAR_ZIP) {
      return res.status(400).json({
        erreur: `${demandeIds.length} demandes sélectionnées : le téléchargement est limité à ${LIMITE_DEMANDES_PAR_ZIP} demandes par fichier ZIP. Réduisez la sélection.`,
      });
    }

    const demandes = await demandeDpaeService.obtenirDemandesPourExport(req.entite, demandeIds, {
      roleCode: req.utilisateur.roleCode,
      utilisateurId: req.utilisateur.id,
    });

    const dateGeneration = new Date();
    const fichiers = [];
    for (const demande of demandes) {
       
      const contenu = await pdfDemandeDpae.genererPdfDemande(demande, { dateGeneration });
      fichiers.push({ nom: pdfDemandeDpae.nomFichierPdf(demande), contenu });
    }

    res.attachment(`Demandes DPAE - ${dateDuJourPourNomFichier(dateGeneration)}.zip`);
    res.type('application/zip');

    const archive = new ZipArchive({ zlib: { level: 9 } });
    // Même limite que l'export ZIP des pièces : une erreur de flux survient après l'envoi des
    // en-têtes, on ne peut plus que couper la réponse.
    archive.on('error', (erreur) => {
      console.error('Échec de génération du ZIP des demandes DPAE :', erreur.message);
      res.destroy();
    });
    archive.pipe(res);
    for (const fichier of fichiers) archive.append(fichier.contenu, { name: fichier.nom });
    await archive.finalize();

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'demandes_dpae_export_pdf_zip',
      tableCible: 'demandes_dpae',
      // 0 = sentinel « aucune cible unique » (plusieurs demandes), comme l'export ZIP des pièces.
      cibleId: 0,
      donnees: { demandeIds, nombreDemandes: demandeIds.length },
      adresseIp: req.ip,
    });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    if (erreur instanceof demandeDpaeService.ErreurExportDemandesRefuse) {
      return res.status(403).json({ erreur: erreur.message });
    }
    next(erreur);
  }
});

// GET /api/dpae — file RH. ?statut=<statut initial> (défaut, file à traiter) ou ?statut=tous
// (historique complet, traitées incluses).
router.get('/', requirePermission('dpaeTraitementRh'), async (req, res, next) => {
  try {
    const statut = req.query.statut === 'tous' ? null : req.query.statut || statutsDpae.STATUT_INITIAL;
    const demandes = await demandeDpaeService.listerPourRh(req.entite, statut);
    res.json(demandes);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dpae/:id — fiche d'une demande. Garde de rôle explicite (2026-09-30 : auparavant aucune,
// le seul fait d'être l'auteur suffisait, quel que soit le rôle) : rôles de consultation seulement,
// puis règle par demande (demandeDpaeService.peutConsulterDemande) — toutes pour Admin, RH et
// Planning. Demande d'une autre entité : introuvable (404), jamais renvoyée.
router.get('/:id', requirePermission('dpaeConsultation'), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const demande = await demandeDpaeService.obtenirDemande(req.entite, id);

    if (!demandeDpaeService.peutConsulterDemande({ roleCode: req.utilisateur.roleCode, utilisateurId: req.utilisateur.id, demande })) {
      return res.status(403).json({ erreur: 'Rôle insuffisant pour cette action.' });
    }

    res.json(demande);
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dpae/:id/pdf — PDF de la fiche, « DPAE <n°> - <NOM> <Prénom>.pdf ».
// EXACTEMENT les règles de GET /:id ci-dessus : même garde de rôle, demande d'une autre entité ->
// 404, demande non consultable -> 403. Chaque téléchargement est tracé dans journal_audit (avant
// l'envoi du fichier).
router.get('/:id/pdf', requirePermission('dpaeConsultation'), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const demande = await demandeDpaeService.obtenirDemande(req.entite, id);

    if (!demandeDpaeService.peutConsulterDemande({ roleCode: req.utilisateur.roleCode, utilisateurId: req.utilisateur.id, demande })) {
      return res.status(403).json({ erreur: 'Rôle insuffisant pour cette action.' });
    }

    const contenu = await pdfDemandeDpae.genererPdfDemande(demande);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'demande_dpae_export_pdf',
      tableCible: 'demandes_dpae',
      cibleId: id,
      donnees: {},
      adresseIp: req.ip,
    });

    res.attachment(pdfDemandeDpae.nomFichierPdf(demande));
    res.type('application/pdf');
    res.send(contenu);
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PUT /api/dpae/:id { …demande complète, version } — modification d'une demande « À traiter » ou « En
// attente » (« En attente » repasse « À traiter », la RH est notifiée). Garde de rôle : dpaeModification
// (Planning, Admin, Inspecteur Hôtellerie) ; droit par demande (auteur, ou Planning/Admin pour toute
// demande) et statut verrouillé vérifiés dans la transaction (demandeDpaeService.modifierDemande).
// Réponse : { statut, version } après modification. utilisateurId, entité et rôle viennent de la
// session, jamais du corps.
router.put('/:id', requirePermission(statutsDpae.permissionPourAction(statutsDpae.ACTION_MODIFIER)), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const { version, ...donnees } = modificationBodySchema.parse(req.body);
    const { statut, version: nouvelleVersion } = await demandeDpaeService.modifierDemande(req.entite, id, {
      donnees,
      version,
      utilisateurId: req.utilisateur.id,
      roleCode: req.utilisateur.roleCode,
      adresseIp: req.ip,
    });
    res.json({ statut, version: nouvelleVersion });
  } catch (erreur) {
    if (!repondreErreurDecision(res, erreur)) next(erreur);
  }
});

// PATCH /api/dpae/:id/valider { version } — « À traiter » ou « En attente » -> « Validée ». La garde
// de rôle, les statuts de départ et la traçabilité (journal_audit, notification du demandeur, dans
// la même transaction que la décision) viennent de statutsDpae.js / demandeDpaeService.js.
router.patch('/:id/valider', requirePermission(statutsDpae.permissionPourAction(statutsDpae.ACTION_VALIDER)), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const { version } = validationBodySchema.parse(req.body);
    await demandeDpaeService.valider(req.entite, id, req.utilisateur.id, { version, adresseIp: req.ip });
    res.status(204).end();
  } catch (erreur) {
    if (!repondreErreurDecision(res, erreur)) next(erreur);
  }
});

// PATCH /api/dpae/:id/rejeter { motifRejet, version } — « À traiter » ou « En attente » -> « Rejetée ».
router.patch('/:id/rejeter', requirePermission(statutsDpae.permissionPourAction(statutsDpae.ACTION_REJETER)), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const { motifRejet, version } = rejetBodySchema.parse(req.body);
    await demandeDpaeService.rejeter(req.entite, id, req.utilisateur.id, motifRejet, { version, adresseIp: req.ip });
    res.status(204).end();
  } catch (erreur) {
    if (!repondreErreurDecision(res, erreur)) next(erreur);
  }
});

// PATCH /api/dpae/:id/mettre-en-attente { motif, version } — « À traiter » -> « En attente », motif
// obligatoire. Depuis tout autre statut : 409. Tracé dans journal_audit (auteur = session, motif) ;
// le demandeur est notifié (demandeDpaeService.mettreEnAttente).
router.patch(
  '/:id/mettre-en-attente',
  requirePermission(statutsDpae.permissionPourAction(statutsDpae.ACTION_METTRE_EN_ATTENTE)),
  async (req, res, next) => {
    try {
      const id = idPositifSchema.parse(req.params.id);
      const { motif, version } = miseEnAttenteBodySchema.parse(req.body);
      await demandeDpaeService.mettreEnAttente(req.entite, id, req.utilisateur.id, motif, { version, adresseIp: req.ip });
      res.status(204).end();
    } catch (erreur) {
      if (!repondreErreurDecision(res, erreur)) next(erreur);
    }
  },
);

// GET /api/dpae/:id/notes — notes propres à la demande, plus récentes d'abord. Lecture
// ouverte aux mêmes rôles que la fiche (dpaeConsultation : Admin, RH, Planning) ; demande
// d'une autre entité : 404, aucune note renvoyée.
router.get('/:id/notes', requirePermission('dpaeConsultation'), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    res.json(await notesDemandeDpaeService.listerNotes(req.entite, id));
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// POST /api/dpae/:id/notes — ajoute une note (auteur pris de la session, jamais du
// corps), mêmes rôles que la lecture. Aucune modification ni suppression (pas de route prévue).
// Chaque ajout est tracé dans journal_audit.
// Ajout de note : dpaeNotes (Admin, RH, Planning) — l'Inspecteur Hôtellerie lit les notes
// (GET ci-dessus, dpaeConsultation) mais n'en ajoute pas.
router.post('/:id/notes', requirePermission('dpaeNotes'), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const { contenu } = noteBodySchema.parse(req.body);
    const resultat = await notesDemandeDpaeService.ajouterNote(req.entite, {
      demandeId: id,
      contenu,
      auteurId: req.utilisateur.id,
    });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'note_demande_dpae_creation',
      tableCible: 'notes_demande_dpae',
      cibleId: resultat.noteId,
      donnees: { demandeId: id, contenu },
      adresseIp: req.ip,
    });

    res.status(201).json(resultat);
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
// Schéma de validation exposé pour dpae.routes.test.js (même convention que dossiers.routes.js :
// aucune infrastructure de test HTTP dans ce projet, on teste le VRAI schéma monté sur POST /,
// jamais une copie).
module.exports.demandeBodySchema = demandeBodySchema;
module.exports.demandeBaseSchema = demandeBaseSchema;
module.exports.modificationBodySchema = modificationBodySchema;
// Filtres du tableau de bord exposés pour dpae.routes.test.js (même raison que ci-dessus).
module.exports.filtresTableauDeBordSchema = filtresTableauDeBordSchema;
// Motif de mise en attente et note exposés pour dpae.routes.test.js (même raison que ci-dessus).
module.exports.miseEnAttenteBodySchema = miseEnAttenteBodySchema;
module.exports.validationBodySchema = validationBodySchema;
module.exports.rejetBodySchema = rejetBodySchema;
module.exports.noteBodySchema = noteBodySchema;
// Export PDF : limite et nom du ZIP exposés pour dpae.routes.test.js.
module.exports.LIMITE_DEMANDES_PAR_ZIP = LIMITE_DEMANDES_PAR_ZIP;
module.exports.dateDuJourPourNomFichier = dateDuJourPourNomFichier;
