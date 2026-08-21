const axios = require('axios');
const { obtenirSecret } = require('../../core/securite/keyVaultClient');

// Client HTTP bas niveau pour l'API SmartOF — forme vérifiée contre le swagger officiel
// (https://europe-west3-academyable-mobileo.cloudfunctions.net/docs/swagger/, consulté le
// 2026-08-21, spec OpenAPI embarquée dans swagger-ui-init.js) : contrairement à
// allMySmsProvider.js, ce fichier n'est pas une hypothèse de forme d'API, la doc réelle a été
// consultée.
//
// Authentification en deux temps (Google Identity Platform / Firebase, pas un endpoint SmartOF à
// proprement parler) :
// 1. POST identitytoolkit.googleapis.com/v1/accounts:signInWithPassword (header `key` = clé API
//    fournie par SmartOF, body {email, password, returnSecureToken:true}) -> idToken (JWT, courte
//    durée — `expiresIn`, ~1h) + refreshToken.
// 2. Chaque appel /api/* porte ensuite `Authorization: Bearer <idToken>`.
// Les 3 secrets (email, mot de passe, clé API) vivent dans Azure Key Vault (décision utilisateur,
// 2026-08-21), jamais en variable d'environnement en clair — contrairement aux identifiants
// AllMySMS (voir config/env.js, dont le commentaire justifie l'inverse pour ce prestataire-là) :
// une compromission ici permettrait d'écrire de fausses données candidat dans un système tiers
// avec lequel ACCECIT a une vraie relation commerciale, pas seulement d'envoyer des SMS.
const IDENTITY_PLATFORM_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
// Endpoint de renouvellement standard Google Identity Platform — NON documenté dans le swagger
// SmartOF lui-même (qui ne couvre que signInWithPassword, voir son tag "Authentification") : à
// vérifier/confirmer auprès de SmartOF avant mise en production, même statut que le reste de ce
// fichier tant que ce point précis n'a pas été testé contre un vrai compte.
const SECURE_TOKEN_URL = 'https://securetoken.googleapis.com/v1/token';
const SERVEUR_BASE_URL = 'https://europe-west3-academyable-mobileo.cloudfunctions.net/external';

// Noms réels des secrets déjà présents dans Key Vault (vérifié le 2026-08-21, `az keyvault
// secret list --vault-name secretsforinscriptions`) — smartof-client-id porte la valeur passée
// dans le champ `email` de signInWithPassword malgré son nom (compte de service SmartOF, pas
// forcément une adresse email au sens strict ; à confirmer lors du premier test réel, voir
// smartOfClient.test.js/scripts de test).
const NOM_SECRET_EMAIL = 'smartof-client-id';
const NOM_SECRET_MOT_DE_PASSE = 'smartof-password';
const NOM_SECRET_CLE_API = 'smartof-api-key';

// Cache mémoire du token en cours, par process (même esprit que promessesParSecret dans
// keyVaultClient.js, mais mutable ici : un token expire et doit être renouvelé, contrairement à un
// secret Key Vault qui ne change qu'après rotation explicite). Renouvelé avec une marge de 60s
// avant l'expiration réelle plutôt qu'au moment exact, pour ne jamais partir avec un token tout
// juste périmé sur un appel qui prendrait quelques centaines de ms.
const MARGE_EXPIRATION_MS = 60_000;
let tokenEnCache = null; // { idToken, refreshToken, expirationMs }

async function authentifier() {
  const [email, motDePasse, cleApi] = await Promise.all([
    obtenirSecret(NOM_SECRET_EMAIL),
    obtenirSecret(NOM_SECRET_MOT_DE_PASSE),
    obtenirSecret(NOM_SECRET_CLE_API),
  ]);

  // La clé API est passée en paramètre de requête (?key=...), pas en header, malgré ce que
  // déclare le swagger SmartOF ("in": "header", voir le commentaire d'en-tête de ce fichier) —
  // convention universelle de toute API REST Google Identity Platform/Firebase Auth (tous les
  // exemples officiels Google utilisent .../accounts:signInWithPassword?key=API_KEY), l'appel
  // ciblant directement identitytoolkit.googleapis.com (voir `servers` du swagger pour cette
  // opération), pas un proxy SmartOF qui appliquerait sa propre convention "header". Corrigé le
  // 2026-08-21 après un premier échec HTTP 403 en header.
  let reponse;
  try {
    reponse = await axios.post(
      IDENTITY_PLATFORM_URL,
      { email, password: motDePasse, returnSecureToken: true },
      { params: { key: cleApi } },
    );
  } catch (erreur) {
    if (erreur.response) {
      const detail = erreur.response.data?.error?.message ?? JSON.stringify(erreur.response.data);
      throw new Error(`Authentification SmartOF (Identity Platform) refusée, HTTP ${erreur.response.status} : ${detail}`);
    }
    throw erreur;
  }

  return {
    idToken: reponse.data.idToken,
    refreshToken: reponse.data.refreshToken,
    expirationMs: Date.now() + Number(reponse.data.expiresIn) * 1000,
  };
}

// Renouvelle via refreshToken plutôt que de renvoyer le mot de passe à chaque fois — voir
// l'avertissement sur SECURE_TOKEN_URL ci-dessus.
async function rafraichirToken(refreshToken) {
  const cleApi = await obtenirSecret(NOM_SECRET_CLE_API);
  const reponse = await axios.post(
    SECURE_TOKEN_URL,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    { params: { key: cleApi } },
  );

  return {
    idToken: reponse.data.id_token,
    refreshToken: reponse.data.refresh_token,
    expirationMs: Date.now() + Number(reponse.data.expires_in) * 1000,
  };
}

async function obtenirTokenValide() {
  if (tokenEnCache && tokenEnCache.expirationMs - MARGE_EXPIRATION_MS > Date.now()) {
    return tokenEnCache.idToken;
  }

  try {
    tokenEnCache = tokenEnCache ? await rafraichirToken(tokenEnCache.refreshToken) : await authentifier();
  } catch {
    // Le refresh peut échouer (refreshToken lui-même expiré/révoqué côté Google) — repli sur une
    // authentification complète plutôt que de propager l'échec du seul refresh.
    tokenEnCache = await authentifier();
  }

  return tokenEnCache.idToken;
}

async function appelerApi(chemin, corps) {
  const idToken = await obtenirTokenValide();
  try {
    const reponse = await axios.post(`${SERVEUR_BASE_URL}${chemin}`, corps, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    return reponse.data;
  } catch (erreur) {
    if (erreur.response) {
      const detail = erreur.response.data?.message ?? JSON.stringify(erreur.response.data);
      throw new Error(`SmartOF a répondu une erreur HTTP ${erreur.response.status} sur ${chemin} : ${detail}`);
    }
    throw erreur;
  }
}

// POST /api/apprenant/create — voir smartOfMapper.js pour la construction du payload attendu
// (customId/email/custom_fields/meta/entrepriseUids/archived, tous obligatoires côté SmartOF).
// Réponse : objet Apprenant, notamment `apprenantUid` (à conserver, voir smartOfService.js /
// table smartof_sync).
function creerApprenant(payload) {
  return appelerApi('/api/apprenant/create', payload);
}

// POST /api/entreprise/list — aucun paramètre de filtre documenté côté SmartOF (requestBody
// absent du swagger pour cet endpoint) : renvoie la liste complète des entreprises, c'est à
// l'appelant (smartOfService.js) de retrouver l'entreprise voulue par son customId.
async function listerEntreprises() {
  const { entreprises } = await appelerApi('/api/entreprise/list');
  return entreprises;
}

module.exports = { creerApprenant, listerEntreprises };
