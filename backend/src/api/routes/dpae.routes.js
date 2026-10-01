const { Router } = require('express');
const { z } = require('zod');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const notesDemandeDpaeService = require('../../core/dpae/notesDemandeDpaeService');
const tableauDeBordDpaeService = require('../../core/dpae/tableauDeBordDpaeService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const {
  ROLES_DPAE_DEMANDEUR,
  ROLES_DPAE_RH,
  ROLES_DPAE_CONSULTATION,
  ROLES_DPAE_TABLEAU_DE_BORD,
  ROLES_DPAE_NOTES,
} = require('../../core/auth/rbac');

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

const demandeBodySchema = z.object({
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
  // Site(s) d'affectation (2026-09-29, demande utilisateur) : liste OBLIGATOIRE d'ids du référentiel
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
  dateDebut: z.string().trim().optional(),
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
})
  // "Nom du salarié remplacé" obligatoire UNIQUEMENT pour un CDD de remplacement (audit 2026-09-29,
  // demande utilisateur) — règle croisée entre champs, d'où ce superRefine plutôt qu'un min(1) sur
  // le champ lui-même (qui l'imposerait dans tous les cas). salarieRemplaceNom est déjà trimé
  // ci-dessus : une saisie faite d'espaces arrive ici vide et est refusée. Aucun contrôle pour un
  // CDI ou un CDD de surcroît d'activité. La date de fin d'absence reste facultative (demande
  // explicite). Colonne inchangée en base, demandes existantes non concernées.
  .superRefine((demande, ctx) => {
    if (demande.typeContrat === 'cdd' && demande.motifCdd === 'remplacement_absent' && !demande.salarieRemplaceNom) {
      ctx.addIssue({
        code: 'custom',
        path: ['salarieRemplaceNom'],
        message: 'Le nom du salarié remplacé est obligatoire pour un CDD de remplacement.',
      });
    }
  });

const rejetBodySchema = z.object({
  motifRejet: z.string().trim().min(1, 'Un motif de rejet est obligatoire.'),
});

// Mise en attente (2026-09-30) : motif OBLIGATOIRE — absent, vide ou fait d'espaces -> 400.
const miseEnAttenteBodySchema = z.object({
  motif: z.string().trim().min(1, 'Un motif de mise en attente est obligatoire.'),
});

// Notes d'une demande DPAE (2026-09-30) : mêmes règles que les notes d'un dossier (notes.routes.js).
const noteBodySchema = z.object({
  contenu: z.string().trim().min(1).max(1000),
});

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// POST /api/dpae — crée une demande et l'envoie directement à la RH (pas de brouillon, voir
// demandeDpaeService.creerEtEnvoyer). utilisateurId toujours pris de la session, jamais du corps
// de la requête — même principe que relances.routes.js.
router.post('/', requireRole(...ROLES_DPAE_DEMANDEUR), async (req, res, next) => {
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
// (ROLES_DPAE_CONSULTATION_TOUTES), 'mes' sur demande. Accueil/Coordination : 403.
router.get('/suivi', requireRole(...ROLES_DPAE_CONSULTATION), async (req, res, next) => {
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

// GET /api/dpae/tableau-de-bord — « Tableau de bord DPAE » (2026-09-30). Indicateurs calculés en
// base, entité courante uniquement (tableauDeBordDpaeService / tableauDeBordDpaeRepository). Accès
// Admin, RH, Planning (ROLES_DPAE_CONSULTATION) ; 403 pour tout autre rôle. Déclarée AVANT
// GET /:id : sinon « tableau-de-bord » serait pris pour un identifiant de demande.
// Filtres (tous optionnels) : debut/fin (AAAA-MM-JJ, jours parisiens de création ; défaut : les 30
// derniers jours), siteId (id d'un site, ou 'non_reference' pour les anciennes demandes sans site
// lié), typeContrat (cdd|cdi), statut (envoyee|en_attente|validee|rejetee). Une valeur vide vaut
// « tous ».
const videVersIndefini = (valeur) => (valeur === '' ? undefined : valeur);
const filtresTableauDeBordSchema = z.object({
  debut: z.preprocess(videVersIndefini, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  fin: z.preprocess(videVersIndefini, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  siteId: z.preprocess(videVersIndefini, z.union([z.literal('non_reference'), idPositifSchema]).optional()),
  typeContrat: enumOptionnel(['cdd', 'cdi']),
  statut: enumOptionnel(['envoyee', 'en_attente', 'validee', 'rejetee']),
});

// ROLES_DPAE_TABLEAU_DE_BORD (2026-10-01) : Admin, RH, Planning — l'Inspecteur Hôtellerie, bien que
// dans ROLES_DPAE_CONSULTATION, n'a pas le tableau de bord DPAE.
router.get('/tableau-de-bord', requireRole(...ROLES_DPAE_TABLEAU_DE_BORD), async (req, res, next) => {
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

// GET /api/dpae — file RH. ?statut=envoyee (défaut, file à traiter) ou ?statut=tous (historique
// complet, traitées incluses).
router.get('/', requireRole(...ROLES_DPAE_RH), async (req, res, next) => {
  try {
    const statut = req.query.statut === 'tous' ? null : req.query.statut || 'envoyee';
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
router.get('/:id', requireRole(...ROLES_DPAE_CONSULTATION), async (req, res, next) => {
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

router.patch('/:id/valider', requireRole(...ROLES_DPAE_RH), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    await demandeDpaeService.valider(req.entite, id, req.utilisateur.id);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'demande_dpae_validation',
      tableCible: 'demandes_dpae',
      cibleId: id,
      donnees: {},
      adresseIp: req.ip,
    });

    res.status(204).end();
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof demandeDpaeService.ErreurDemandeDejaTraitee) {
      return res.status(409).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

router.patch('/:id/rejeter', requireRole(...ROLES_DPAE_RH), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const { motifRejet } = rejetBodySchema.parse(req.body);
    await demandeDpaeService.rejeter(req.entite, id, req.utilisateur.id, motifRejet);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'demande_dpae_rejet',
      tableCible: 'demandes_dpae',
      cibleId: id,
      donnees: { motifRejet },
      adresseIp: req.ip,
    });

    res.status(204).end();
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof demandeDpaeService.ErreurDemandeDejaTraitee) {
      return res.status(409).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// PATCH /api/dpae/:id/mettre-en-attente (2026-09-30) — « À traiter » -> « En attente », RH/Admin
// (ROLES_DPAE_RH), motif obligatoire. Depuis tout autre statut : 409. Tracé dans journal_audit
// (auteur = session, motif) ; le demandeur est notifié (demandeDpaeService.mettreEnAttente).
router.patch('/:id/mettre-en-attente', requireRole(...ROLES_DPAE_RH), async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const { motif } = miseEnAttenteBodySchema.parse(req.body);
    await demandeDpaeService.mettreEnAttente(req.entite, id, req.utilisateur.id, motif);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'demande_dpae_mise_en_attente',
      tableCible: 'demandes_dpae',
      cibleId: id,
      donnees: { motif },
      adresseIp: req.ip,
    });

    res.status(204).end();
  } catch (erreur) {
    if (erreur instanceof demandeDpaeService.ErreurDemandeIntrouvable) {
      return res.status(404).json({ erreur: erreur.message });
    }
    if (erreur instanceof demandeDpaeService.ErreurDemandeDejaTraitee) {
      return res.status(409).json({ erreur: erreur.message });
    }
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dpae/:id/notes (2026-09-30) — notes propres à la demande, plus récentes d'abord. Lecture
// ouverte aux mêmes rôles que la fiche (ROLES_DPAE_CONSULTATION : Admin, RH, Planning) ; demande
// d'une autre entité : 404, aucune note renvoyée.
router.get('/:id/notes', requireRole(...ROLES_DPAE_CONSULTATION), async (req, res, next) => {
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

// POST /api/dpae/:id/notes (2026-09-30) — ajoute une note (auteur pris de la session, jamais du
// corps), mêmes rôles que la lecture. Aucune modification ni suppression (pas de route prévue).
// Chaque ajout est tracé dans journal_audit.
// Ajout de note : ROLES_DPAE_NOTES (Admin, RH, Planning) — l'Inspecteur Hôtellerie lit les notes
// (GET ci-dessus, ROLES_DPAE_CONSULTATION) mais n'en ajoute pas (2026-10-01).
router.post('/:id/notes', requireRole(...ROLES_DPAE_NOTES), async (req, res, next) => {
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
// Filtres du tableau de bord exposés pour dpae.routes.test.js (même raison que ci-dessus).
module.exports.filtresTableauDeBordSchema = filtresTableauDeBordSchema;
// Motif de mise en attente et note exposés pour dpae.routes.test.js (même raison que ci-dessus).
module.exports.miseEnAttenteBodySchema = miseEnAttenteBodySchema;
module.exports.noteBodySchema = noteBodySchema;
