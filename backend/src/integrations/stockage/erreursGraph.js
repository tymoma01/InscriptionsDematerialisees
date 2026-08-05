// Traduit une erreur Microsoft Graph (GraphError : statusCode + code, cf. SDK
// @microsoft/microsoft-graph-client) en erreur métier lisible, pour ne pas remonter du JSON
// technique jusqu'aux logs/UI. `contexte` situe l'appel concerné (ex. "upload pièce justificative").
// `permission` : nom de la permission d'application Graph à vérifier en cas de 403, affiché dans
// le message pour guider le diagnostic — "Files.ReadWrite.All" par défaut (usage historique
// SharePoint/OneDrive, voir azureOneDriveConnector.js), à surcharger par tout autre appelant Graph
// dont la permission requise diffère (ex. "Mail.Send" pour graphMailProvider.js).
function traduireErreurGraph(erreur, contexte, { permission = 'Files.ReadWrite.All' } = {}) {
  const statut = erreur && erreur.statusCode;
  const code = erreur && erreur.code;

  if (statut === 401 || code === 'InvalidAuthenticationToken' || code === 'TokenExpired') {
    return new Error(
      `Authentification Microsoft Graph expirée ou invalide (${contexte}) — vérifier la validité des secrets ` +
        `Key Vault graph-client-id/graph-client-secret/graph-tenant-id.`,
    );
  }

  // ErrorAccessDenied : code renvoyé par l'API mail (/users/{id}/sendMail) pour un 403, distinct
  // d'AccessDenied/Forbidden côté API fichiers (SharePoint/OneDrive) — voir graphMailProvider.js.
  if (statut === 403 || code === 'AccessDenied' || code === 'Forbidden' || code === 'ErrorAccessDenied') {
    return new Error(
      `Permissions Microsoft Graph insuffisantes (${contexte}) — vérifier que l'app registration dispose bien ` +
        `de la permission d'application "${permission}" avec consentement admin accordé.`,
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
