const { utilisateurARole } = require('../../core/auth/rbac');

// À monter après requireAuth (auth.middleware.js) sur une route donnée — s'appuie sur
// req.utilisateur déjà posé par celui-ci.
function requireRole(...codesAutorises) {
  return (req, res, next) => {
    if (!utilisateurARole(req.utilisateur, ...codesAutorises)) {
      return res.status(403).json({ erreur: 'Rôle insuffisant pour cette action.' });
    }
    next();
  };
}

module.exports = { requireRole };
