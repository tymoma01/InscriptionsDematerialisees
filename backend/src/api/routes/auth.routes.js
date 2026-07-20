const { Router } = require('express');
const { z } = require('zod');
const authService = require('../../core/auth/authService');
const journalAudit = require('../../core/audit/journalAudit');
const { obtenirKnex } = require('../../db/knex');
const { limiteurConnexion } = require('../middlewares/rateLimiter');
const { requireAuth } = require('../middlewares/auth.middleware');

const router = Router();

const connexionSchema = z.object({
  email: z.string().trim().email(),
  motDePasse: z.string().min(1),
});

// POST /api/auth/connexion — ouvre une session serveur (express-session + connect-pg-simple,
// voir core/auth/session.js). Message d'erreur volontairement identique pour email inconnu et
// mot de passe erroné (voir authService.connecter) : ne jamais révéler si un compte existe pour
// cette entité.
router.post('/connexion', limiteurConnexion, async (req, res, next) => {
  try {
    const { email, motDePasse } = connexionSchema.parse(req.body);
    const utilisateurSession = await authService.connecter(req.entite, { email, motDePasse });

    const bd = await obtenirKnex();
    await journalAudit.enregistrerAction(bd, {
      utilisateurId: utilisateurSession?.id ?? null,
      entiteId: req.entite.id,
      action: utilisateurSession ? 'connexion_reussie' : 'connexion_echouee',
      tableCible: 'utilisateurs',
      cibleId: utilisateurSession?.id ?? 0,
      donnees: utilisateurSession ? {} : { email },
      adresseIp: req.ip,
    });

    if (!utilisateurSession) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
    }

    // Régénère l'identifiant de session à la connexion (protection contre la fixation de
    // session) avant d'y poser l'utilisateur — pratique standard, indépendante du reste du
    // chantier auth/RBAC mais rattachée ici car c'est la seule route qui écrit en session.
    req.session.regenerate((erreurRegenerate) => {
      if (erreurRegenerate) return next(erreurRegenerate);
      req.session.utilisateur = utilisateurSession;
      req.session.save((erreurSave) => {
        if (erreurSave) return next(erreurSave);
        res.json({ utilisateur: utilisateurSession });
      });
    });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      return res.status(400).json({ erreur: 'Données invalides.', details: erreur.flatten() });
    }
    next(erreur);
  }
});

// POST /api/auth/deconnexion — détruit la session serveur (donc la ligne correspondante dans le
// store connect-pg-simple), pas seulement le cookie côté client.
router.post('/deconnexion', requireAuth, (req, res, next) => {
  const { id: utilisateurId } = req.utilisateur;
  const { id: entiteId } = req.entite;
  const adresseIp = req.ip;

  req.session.destroy(async (erreur) => {
    if (erreur) return next(erreur);
    res.clearCookie('sid');
    try {
      const bd = await obtenirKnex();
      await journalAudit.enregistrerAction(bd, {
        utilisateurId,
        entiteId,
        action: 'deconnexion',
        tableCible: 'utilisateurs',
        cibleId: utilisateurId,
        adresseIp,
      });
      res.status(204).end();
    } catch (erreurAudit) {
      next(erreurAudit);
    }
  });
});

// GET /api/auth/moi — utilisé par le front (voir frontend/src/core/auth/useSession.js) pour
// savoir si une session est active au chargement de l'app.
router.get('/moi', requireAuth, (req, res) => {
  res.json({ utilisateur: req.utilisateur });
});

module.exports = router;
