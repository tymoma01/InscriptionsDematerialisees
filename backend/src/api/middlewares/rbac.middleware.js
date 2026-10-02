const { PERMISSIONS, aPermission } = require('../../core/auth/permissions');

// À monter après requireAuth (auth.middleware.js) — s'appuie sur req.utilisateur posé par celui-ci.
// Une clé inconnue fait échouer le démarrage plutôt que de refuser silencieusement à l'exécution.
function requirePermission(cle) {
  if (!PERMISSIONS[cle]) throw new Error(`Permission inconnue : « ${cle} »`);
  return (req, res, next) => {
    if (!req.utilisateur || !aPermission(req.utilisateur.roleCode, cle)) {
      return res.status(403).json({ erreur: 'Rôle insuffisant pour cette action.' });
    }
    next();
  };
}

module.exports = { requirePermission };
