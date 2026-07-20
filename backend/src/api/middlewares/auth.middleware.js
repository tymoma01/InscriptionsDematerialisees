// Middleware d'authentification par session — à monter après entiteContext (qui résout
// req.entite, voir entiteContext.middleware.js) et après le middleware express-session
// (voir core/auth/session.js, monté globalement dans app.js). Bloque toute requête sans
// session valide.
//
// Vérifie aussi explicitement que l'utilisateur en session appartient bien à l'entité résolue
// pour cette requête : entiteContext résout l'entité indépendamment de la session (uniquement
// par sous-domaine), donc sans ce contrôle un agent de l'entité A pourrait agir sur les données
// de l'entité B en rejouant son cookie encore valide sur un autre sous-domaine (voir
// docs/schema-bdd-proposition.md, point ouvert n°5, "isolation multi-entité au niveau session").
function requireAuth(req, res, next) {
  const utilisateur = req.session?.utilisateur;

  if (!utilisateur) {
    return res.status(401).json({ erreur: 'Authentification requise.' });
  }
  if (utilisateur.entiteId !== req.entite.id) {
    return res.status(403).json({ erreur: "Cette session n'est pas valide pour cette entité." });
  }

  req.utilisateur = utilisateur;
  next();
}

module.exports = { requireAuth };
