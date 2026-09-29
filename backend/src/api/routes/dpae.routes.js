const { Router } = require('express');
const { z } = require('zod');
const demandeDpaeService = require('../../core/dpae/demandeDpaeService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES_DPAE_DEMANDEUR, ROLES_DPAE_RH } = require('../../core/auth/rbac');

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
  // Texte libre (pas une FK `lieux`, voir migration 066 et son commentaire) : `lieux` liste les
  // lieux de TEST candidat, une notion distincte de l'hôtel concerné par une demande de staffing.
  // Obligatoire (audit 2026-09-29, demande utilisateur) : une DPAE porte toujours sur un hôtel —
  // module Hôtellerie uniquement (postes hôtel seuls, voir DemandeDpae.jsx). Contrôlé ici, pas
  // seulement dans le formulaire : trim() puis min(1) rejette aussi une saisie faite d'espaces.
  // La colonne reste nullable en base (demandes antérieures inchangées).
  hotel: z.string().trim().min(1, "L'hôtel est obligatoire."),
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
      donnees: { typeDemande: donnees.typeDemande },
      adresseIp: req.ip,
    });

    res.status(201).json({ demandeId });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

// GET /api/dpae/mes-demandes — demandes créées par l'agent connecté, tous statuts (onglet
// "Suivi des demandes").
router.get('/mes-demandes', requireRole(...ROLES_DPAE_DEMANDEUR), async (req, res, next) => {
  try {
    const demandes = await demandeDpaeService.listerMesDemandes(req.entite, req.utilisateur.id);
    res.json(demandes);
  } catch (erreur) {
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

// GET /api/dpae/:id — détail, accessible au demandeur propriétaire ou à la RH/Admin. Le contrôle
// "propriétaire" est appliqué ici (pas dans requireRole, qui ne connaît pas la ressource) —
// même principe que moi.routes.js pour un accès self-service.
router.get('/:id', async (req, res, next) => {
  try {
    const id = idPositifSchema.parse(req.params.id);
    const demande = await demandeDpaeService.obtenirDemande(req.entite, id);

    const estRh = ROLES_DPAE_RH.includes(req.utilisateur.roleCode);
    const estProprietaire = demande.demandeur_id === req.utilisateur.id;
    if (!estRh && !estProprietaire) {
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

module.exports = router;
// Schéma de validation exposé pour dpae.routes.test.js (même convention que dossiers.routes.js :
// aucune infrastructure de test HTTP dans ce projet, on teste le VRAI schéma monté sur POST /,
// jamais une copie).
module.exports.demandeBodySchema = demandeBodySchema;
