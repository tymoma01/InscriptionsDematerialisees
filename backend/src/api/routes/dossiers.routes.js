const { Router } = require('express');
const { z } = require('zod');
const dossierService = require('../../core/dossier/dossierService');
const relanceService = require('../../core/dossier/relanceService');
const rendezvousService = require('../../core/rendezvous/rendezvousService');
const workflowEngine = require('../../core/workflow/workflowEngine');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');
const { requireRole } = require('../middlewares/rbac.middleware');
const { ROLES } = require('../../core/auth/rbac');

// Monté sur '/api/dossiers' (voir app.js) — distinct du routeur pièces justificatives, monté
// lui sur '/api/dossiers/:dossierId/pieces' (pieces.routes.js) : les deux coexistent sans
// collision, aucune route ici ne définit de segment dynamique qui capturerait '/pieces'.
const router = Router();

router.use(requireAuth);

// Vue centralisée des dossiers (CLAUDE.md, besoins Accueil/Coordination : "vue centralisée des
// dossiers en attente") — mêmes rôles que la gestion des pièces justificatives (pieces.routes.js),
// c'est la suite du même parcours interne.
const ROLES_CONSULTATION_DOSSIERS = [ROLES.ACCUEIL_COORDINATION, ROLES.RECRUTEUR, ROLES.ADMIN];

// Formateur/Inspecteur ajoutés ici UNIQUEMENT pour GET /rendezvous ci-dessous (audit 2026-08-20,
// accès à "Suivi des tests") — pas à ROLES_CONSULTATION_DOSSIERS lui-même : ces deux rôles n'ont
// pas à voir la liste complète des dossiers, ni les motifs/statuts/transitions des autres routes de
// ce fichier, seulement leurs propres rendez-vous de test (voir la restriction posée dans le
// handler de la route, jamais un simple filtrage d'affichage côté front).
const ROLES_CONSULTATION_RENDEZVOUS_TEST = [...ROLES_CONSULTATION_DOSSIERS, ROLES.FORMATEUR, ROLES.INSPECTEUR];

// Formateur/Inspecteur, lecture seule sur UN dossier précis (audit 2026-08-19, écrans
// d'évaluation — étendu le 2026-08-20 au résumé GET /:dossierId, bouton "Voir le dossier" sur
// Suivi des tests) — même patron que ROLES_CONSULTATION_PIECES (pieces.routes.js), la vraie garde
// de modification restant ROLES_MODIFICATION_INSCRIPTION plus bas, inchangée. Distinct de
// ROLES_CONSULTATION_DOSSIERS (pas réutilisé tel quel) : ne pas donner à Formateur/Inspecteur un
// accès aux AUTRES routes de ce fichier (liste des dossiers, statuts, transitions...) — seulement
// au résumé et aux infos d'inscription d'UN dossier précis, consulté depuis Relances.jsx
// ("Voir le dossier") ou GrilleEvaluation.jsx (InformationsInscription). GET /rendezvous reste à
// part (ROLES_CONSULTATION_RENDEZVOUS_TEST ci-dessus), déjà scopé différemment (tous dossiers,
// pas un seul).
const ROLES_LECTURE_INSCRIPTION = [...ROLES_CONSULTATION_DOSSIERS, ROLES.FORMATEUR, ROLES.INSPECTEUR];

// GET /api/dossiers?statut=code — liste des dossiers de l'entité courante, filtrable par statut.
// Le code de statut n'est jamais figé ici : il vient de la table `statuts`, configurable par
// entité (voir Modularité, CLAUDE.md) — un code inconnu pour l'entité renvoie simplement une
// liste vide, pas une erreur.
router.get('/', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const dossiers = await dossierService.listerDossiers(req.entite, { statutCode: req.query.statut });
    res.json(dossiers);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/statuts — statuts configurés pour l'entité courante, dans l'ordre du
// workflow ; sert à construire les filtres du tableau de bord sans coder de code de statut en
// dur côté front (voir core/workflow/StatutBadge.jsx, pages/accueil/TableauDeBordAccueil.jsx).
router.get('/statuts', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const statuts = await dossierService.listerStatuts(req.entite);
    res.json(statuts);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/relances/motifs-resultat — résultats de relance configurés pour l'entité
// courante (table `motifs`, categorie 'resultat_relance'), pas propre à un dossier en
// particulier : sert à construire le formulaire d'ajout d'une relance sans coder de code en dur
// côté front (voir core/dossier/HistoriqueRelances.jsx). Vit ici plutôt que dans
// relances.routes.js (monté sur '/api/dossiers/:dossierId/relances') car cette liste ne dépend
// d'aucun dossierId — même logique que GET /api/dossiers/statuts ci-dessus.
router.get('/relances/motifs-resultat', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const motifs = await relanceService.listerMotifsResultatRelance(req.entite);
    res.json(motifs);
  } catch (erreur) {
    next(erreur);
  }
});

const idPositifSchema = z.coerce.number().int().positive();

const rendezvousTestQuerySchema = z.object({
  aVenir: z.enum(['true', 'false']).optional(),
  formateurId: z.coerce.number().int().positive().optional(),
  // 'AAAA-MM-JJ', bornes du calendrier de disponibilité formateur (dateFin exclusive) — voir
  // CalendrierDisponibiliteFormateur.jsx.
  dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// GET /api/dossiers/rendezvous — vue d'ensemble des rendez-vous de test, tous dossiers
// confondus pour Accueil/Coordination/Recruteur/Admin (page Planification, CLAUDE.md : "planifie
// les tests") — filtrable par aVenir (statut prevu/confirme + date future), par formateurId, et
// par plage de dates (dateDebut/dateFin, pour le calendrier mensuel de disponibilité). Distinct de
// GET /api/dossiers/:dossierId/rendezvous (rendezvous.routes.js), qui liste les rendez-vous d'UN
// dossier précis — même logique "pas propre à un dossier en particulier" que les routes de
// motifs ci-dessous.
//
// Formateur/Inspecteur (audit 2026-08-20) : ne voient QUE leurs propres rendez-vous assignés,
// jamais ceux d'un autre formateur/inspecteur — `formateurId` reçu en query est donc IGNORÉ pour
// ces deux rôles et remplacé par req.utilisateur.id, quoi qu'envoie le client. Restriction posée
// ici, côté serveur, pas seulement par le masquage du sélecteur "Formateur" côté front
// (Planification.jsx) : un appel direct à cette route avec un autre formateurId doit rester sans
// effet pour ces rôles, même principe que ROLES_MODIFICATION_INSCRIPTION plus bas dans ce fichier.
router.get('/rendezvous', requireRole(...ROLES_CONSULTATION_RENDEZVOUS_TEST), async (req, res, next) => {
  try {
    const { aVenir, formateurId, dateDebut, dateFin } = rendezvousTestQuerySchema.parse(req.query);
    const estFormateurOuInspecteur = [ROLES.FORMATEUR, ROLES.INSPECTEUR].includes(req.utilisateur.roleCode);
    const rendezvous = await rendezvousService.listerRendezvousTest(req.entite, {
      aVenirSeulement: aVenir === 'true',
      formateurId: estFormateurOuInspecteur ? req.utilisateur.id : formateurId,
      dateDebut,
      dateFin,
    });
    res.json(rendezvous);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

// dossierIds="12,45,67" (CSV, pas de tableau répété en query string — plus simple à construire
// côté front, voir services/rendezvousService.js) — transformé puis validé comme un tableau
// d'entiers positifs non vide via .pipe().
const historiqueRendezvousQuerySchema = z.object({
  dossierIds: z
    .string()
    .trim()
    .min(1)
    .transform((valeur) => valeur.split(','))
    .pipe(z.array(idPositifSchema).min(1)),
});

// GET /api/dossiers/rendezvous/historique?dossierIds=12,45,67 — historique COMPLET (passé et
// futur, tous statuts, catégorisés) des rendez-vous de test d'un ou plusieurs dossiers (bouton
// "Voir l'historique des rendez-vous sélectionnés", page Planification côté Coordination) — voir
// rendezvousService.listerHistoriqueRendezvousDossiers pour la logique de catégorisation
// (À venir/Honoré/Manqué/Annulé/Replanifié/À traiter). Distinct de GET /api/dossiers/rendezvous
// ci-dessus (rendez-vous À VENIR uniquement, tous dossiers confondus) : ici c'est l'inverse,
// TOUT l'historique mais seulement des dossiers demandés. Déclarée avant '/rendezvous/
// motifs-desistement' ci-dessous : simple ordre de lecture, aucune collision possible entre
// segments littéraux distincts.
router.get('/rendezvous/historique', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const { dossierIds } = historiqueRendezvousQuerySchema.parse(req.query);
    const historique = await rendezvousService.listerHistoriqueRendezvousDossiers(req.entite, dossierIds);
    res.json(historique);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

// GET /api/dossiers/rendezvous/motifs-desistement — motifs de désistement configurés pour
// l'entité courante (table `motifs`, categorie 'desistement'), pas propre à un dossier en
// particulier — même logique que GET /api/dossiers/relances/motifs-resultat ci-dessus.
router.get('/rendezvous/motifs-desistement', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const motifs = await rendezvousService.listerMotifsDesistement(req.entite);
    res.json(motifs);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/transitions/motifs?codeAction=X — motifs configurés pour une action de la
// machine à états (categorie === codeAction, voir core/workflow/workflowEngine.js), pas propre à
// un dossier en particulier — même logique que les deux routes de motifs ci-dessus. Sert au
// back-office recruteur à construire le sélecteur de motif d'une décision (ex. rejeter_dossier)
// sans connaître les codes possibles à l'avance.
router.get('/transitions/motifs', requireRole(...ROLES_CONSULTATION_DOSSIERS), async (req, res, next) => {
  try {
    const { codeAction } = z.object({ codeAction: z.string().trim().min(1) }).parse(req.query);
    const motifs = await workflowEngine.listerMotifsPourAction(req.entite, codeAction);
    res.json(motifs);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId — un seul dossier (statut + nom/prénom du candidat déjà joints,
// voir dossierService.obtenirDossier), pour un écran qui a besoin d'identifier le candidat sans
// recharger la liste complète de l'entité (ex. en-tête de CaptureTablette.jsx). Déclarée en
// dernier, après toutes les routes à segment littéral ci-dessus ('/statuts', '/rendezvous', ...) :
// un ':dossierId' générique enregistré plus tôt les intercepterait (ex. '/statuts' matchant
// dossierId='statuts'). Aucune collision avec les routeurs montés séparément sur
// '/api/dossiers/:dossierId/pieces' etc. (voir app.js) : ce pattern à un seul segment ne matche
// pas un chemin qui a un segment de plus.
//
// Formateur/Inspecteur ajoutés ici (audit 2026-08-20, bouton "Voir le dossier" sur Suivi des
// tests) — même résumé de dossier (jamais le NIR, jamais les pièces) que ROLES_LECTURE_INSCRIPTION
// leur accorde déjà pour la section "Informations d'inscription complètes" ; sert ici uniquement
// à afficher le titre "Dossier #X - NOM Prénom" de la fiche (Relances.jsx) — pas d'accès à
// GET /api/dossiers (liste complète), resté fermé à ces deux rôles.
router.get('/:dossierId', requireRole(...ROLES_LECTURE_INSCRIPTION), async (req, res, next) => {
  try {
    const dossier = await dossierService.obtenirDossier(req.entite, req.params.dossierId);
    if (!dossier) {
      return res.status(404).json({ erreur: `Dossier "${req.params.dossierId}" introuvable.` });
    }
    res.json(dossier);
  } catch (erreur) {
    next(erreur);
  }
});

// GET /api/dossiers/:dossierId/inscription — candidat (hors NIR, jamais déchiffré pour un
// affichage back-office générique, voir dossierRepository.trouverInscriptionCompleteParDossierId)
// + tous les blocs de dossier_donnees_formulaire déjà enregistrés pour ce dossier, pour la
// section repliable "Informations d'inscription complètes" (Validation.jsx/Relances.jsx, et
// désormais GrilleEvaluation.jsx pour Formateur/Inspecteur, voir ROLES_LECTURE_INSCRIPTION
// déclaré plus haut avec les autres rôles).
router.get('/:dossierId/inscription', requireRole(...ROLES_LECTURE_INSCRIPTION), async (req, res, next) => {
  try {
    const inscription = await dossierService.obtenirInscriptionComplete(req.entite, req.params.dossierId);
    if (!inscription) {
      return res.status(404).json({ erreur: `Dossier "${req.params.dossierId}" introuvable.` });
    }
    res.json(inscription);
  } catch (erreur) {
    next(erreur);
  }
});

// Correction d'une erreur de saisie du candidat après coup (bouton "Modifier",
// InformationsInscription.jsx) — réservée à Accueil/Coordination et Admin (voir CLAUDE.md,
// demande explicite : ni Recruteur, ni Formateur/Inspecteur). Restriction posée ICI, au niveau de
// la route, pas seulement en affichage front (le bouton "Modifier" y est masqué pour les autres
// rôles, mais un appel API direct doit être refusé indépendamment de ce masquage) — même principe
// que le reste de ce fichier (chaque route pose sa propre restriction, jamais héritée d'un autre
// contrôle supposé déjà fait ailleurs).
const ROLES_MODIFICATION_INSCRIPTION = [ROLES.ACCUEIL_COORDINATION, ROLES.ADMIN];

router.patch('/:dossierId/inscription', requireRole(...ROLES_MODIFICATION_INSCRIPTION), async (req, res, next) => {
  try {
    const inscription = await dossierService.modifierInscription(req.entite, req.params.dossierId, req.body);
    if (!inscription) {
      return res.status(404).json({ erreur: `Dossier "${req.params.dossierId}" introuvable.` });
    }

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'dossier_inscription_modifiee',
      tableCible: 'dossiers',
      cibleId: Number(req.params.dossierId),
      adresseIp: req.ip,
    });

    res.json(inscription);
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    if (erreur instanceof dossierService.ErreurInscriptionConflit) {
      return res.status(409).json({ erreur: erreur.message, champ: erreur.champ });
    }
    next(erreur);
  }
});

module.exports = router;
