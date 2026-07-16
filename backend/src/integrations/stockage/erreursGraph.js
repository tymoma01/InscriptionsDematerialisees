// Traduit une erreur Microsoft Graph (GraphError : statusCode + code, cf. SDK
// @microsoft/microsoft-graph-client) en erreur métier lisible, pour ne pas remonter du JSON
// technique jusqu'aux logs/UI. `contexte` situe l'appel concerné (ex. "upload pièce justificative").
function traduireErreurGraph(erreur, contexte) {
  const statut = erreur && erreur.statusCode;
  const code = erreur && erreur.code;

  if (statut === 401 || code === 'InvalidAuthenticationToken' || code === 'TokenExpired') {
    return new Error(
      `Authentification Microsoft Graph expirée ou invalide (${contexte}) — vérifier la validité des secrets ` +
        `Key Vault graph-client-id/graph-client-secret/graph-tenant-id.`,
    );
  }

  if (statut === 403 || code === 'AccessDenied' || code === 'Forbidden') {
    return new Error(
      `Permissions Microsoft Graph insuffisantes (${contexte}) — vérifier que l'app registration dispose bien ` +
        `de la permission d'application "Files.ReadWrite.All" avec consentement admin accordé.`,
    );
  }

  if (statut === 409 || code === 'nameAlreadyExists') {
    return new Error(`Un fichier ou dossier existe déjà à cet emplacement sur SharePoint (${contexte}).`);
  }

  if (statut === 404 || code === 'itemNotFound') {
    return new Error(`Fichier ou dossier introuvable sur SharePoint (${contexte}).`);
  }

  if (statut === 429) {
    return new Error(
      `Limite de débit Microsoft Graph atteinte (${contexte}) — trop de requêtes envoyées, réessayer plus tard.`,
    );
  }

  return new Error(`Échec de l'appel Microsoft Graph (${contexte}) : ${(erreur && erreur.message) || erreur}`);
}

module.exports = { traduireErreurGraph };
