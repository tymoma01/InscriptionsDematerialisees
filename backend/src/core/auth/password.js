const argon2 = require('argon2');

// argon2id (variante par défaut de la lib) — recommandé OWASP, résistant GPU/ASIC, cohérent
// avec le choix argon2 acté dans CLAUDE.md (section Authentification et rôles).
function hacherMotDePasse(motDePasseClair) {
  return argon2.hash(motDePasseClair);
}

// Retourne false plutôt que de lever, y compris si le hash stocké est malformé : un mot de
// passe invalide ne doit jamais faire planter la route de connexion.
async function verifierMotDePasse(motDePasseClair, hash) {
  try {
    return await argon2.verify(hash, motDePasseClair);
  } catch {
    return false;
  }
}

module.exports = { hacherMotDePasse, verifierMotDePasse };
