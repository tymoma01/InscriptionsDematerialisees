const { Router } = require('express');
const { z } = require('zod');
const utilisateurRepository = require('../../core/auth/utilisateurRepository');
const utilisateurService = require('../../core/auth/utilisateurService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { requireAuth } = require('../middlewares/auth.middleware');

// Monté sur '/api/moi' (voir app.js) — self-service, distinct de '/api/utilisateurs' (gestion des
// comptes, admin uniquement) : n'importe quel rôle authentifié peut consulter/modifier SON PROPRE
// compte ici (écran "Mon profil", audit 2026-08-28, formateur/inspecteur en premier usage), jamais
// celui d'un autre — req.utilisateur.id (posé par requireAuth depuis la session, jamais depuis
// params/body) est la seule source possible pour l'id ciblé dans tout ce routeur.
const router = Router();

router.use(requireAuth);

// '' accepté (efface le numéro), même convention que utilisateurs.routes.js.
const telephoneSchema = z.string().trim();

const miseAJourProfilSchema = z
  .object({
    telephone: telephoneSchema.optional(),
    recevoirEmailPlanification: z.boolean().optional(),
  })
  .refine((donnees) => donnees.telephone !== undefined || donnees.recevoirEmailPlanification !== undefined, {
    message: 'Aucun champ à mettre à jour.',
  });

function repondreErreurValidation(res, erreurZod) {
  res.status(400).json({ erreur: 'Données invalides.', details: erreurZod.flatten() });
}

// Réponse volontairement restreinte, même principe que serialiserUtilisateur dans
// utilisateurs.routes.js — jamais mot_de_passe_hash/role_id brut.
function serialiserMonProfil(utilisateur) {
  return {
    nom: utilisateur.nom,
    prenom: utilisateur.prenom,
    email: utilisateur.email,
    roleCode: utilisateur.role_code,
    roleLibelle: utilisateur.role_libelle,
    telephone: utilisateur.telephone,
    recevoirEmailPlanification: utilisateur.recevoir_email_planification,
  };
}

// GET /api/moi — profil du compte connecté (Nom/Prénom/Email/Rôle en lecture seule côté front,
// Téléphone/préférence email modifiables, voir PATCH ci-dessous).
router.get('/', async (req, res, next) => {
  try {
    const bd = await obtenirKnex();
    const utilisateur = await utilisateurRepository.trouverUtilisateurParId(bd, req.entite.id, req.utilisateur.id);
    res.json(serialiserMonProfil(utilisateur));
  } catch (erreur) {
    next(erreur);
  }
});

// PATCH /api/moi — met à jour uniquement telephone et/ou recevoirEmailPlanification du compte
// connecté (tous deux optionnels, au moins un requis). recevoirEmailPlanification décoché : plus
// d'email personnalisé "Nouveau candidat à évaluer"/"Test replanifié" envoyé à ce formateur/
// inspecteur lors d'une future planification le concernant (voir invitationTestService.js) —
// l'événement Outlook reste créé normalement, aucun changement à graphCalendarService.
router.patch('/', async (req, res, next) => {
  try {
    const donnees = miseAJourProfilSchema.parse(req.body);

    await utilisateurService.mettreAJourMonProfil(req.utilisateur.id, donnees);

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: req.utilisateur.id,
      entiteId: req.entite.id,
      action: 'utilisateur_maj_profil',
      tableCible: 'utilisateurs',
      cibleId: req.utilisateur.id,
      donnees,
      adresseIp: req.ip,
    });

    // Relu avec la jointure roles (mettreAJourUtilisateur, lui, ne renvoie que la ligne
    // utilisateurs brute) — même valeur que GET ci-dessus, pour que le front puisse simplement
    // réafficher la réponse du PATCH sans requête supplémentaire.
    const utilisateur = await utilisateurRepository.trouverUtilisateurParId(bd, req.entite.id, req.utilisateur.id);
    res.json(serialiserMonProfil(utilisateur));
  } catch (erreur) {
    if (erreur instanceof z.ZodError) return repondreErreurValidation(res, erreur);
    next(erreur);
  }
});

module.exports = router;
